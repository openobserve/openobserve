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

use std::{ops::ControlFlow, sync::Arc};

use arrow_schema::{DataType, Field};
use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::{
        inverted_index::IndexOptimizeMode,
        search::SearchEventType,
        sql::{OrderBy, TableReferenceExt, resolve_stream_names_with_type},
        stream::StreamType,
    },
    utils::sql::AGGREGATE_UDF_LIST,
};
use datafusion::{
    arrow::datatypes::Schema,
    common::{TableReference, tree_node::TreeNode},
};
use hashbrown::{HashMap, HashSet};
use infra::{
    errors::{Error, ErrorCodes},
    schema::{SchemaCache, get_stream_setting_fts_fields, unwrap_stream_settings},
};
use once_cell::sync::Lazy;
use proto::cluster_rpc::SearchQuery;
use regex::Regex;
use sqlparser::{
    ast::{
        BinaryOperator, DuplicateTreatment, Expr, Function, FunctionArg, FunctionArgExpr,
        FunctionArgumentList, FunctionArguments, GroupByExpr, Ident, ObjectName, ObjectNamePart,
        OrderByExpr, OrderByKind, OrderByOptions, Query, Select, SelectFlavor, SelectItem, SetExpr,
        Statement, TableFactor, TableWithJoins, Value, ValueWithSpan, VisitMut, VisitorMut,
        helpers::attached_token::AttachedToken,
    },
    dialect::PostgreSqlDialect,
    parser::Parser,
    tokenizer::Span,
};

#[cfg(feature = "enterprise")]
use super::datafusion::udf::cipher_udf::{
    DECRYPT_SLOW_UDF_NAME, DECRYPT_UDF_NAME, ENCRYPT_UDF_NAME,
};
use super::{
    index::{Condition, IndexCondition},
    request::Request,
    utils::conjunction,
};
use crate::service::search::{
    cluster::flight::{generate_context, register_table},
    datafusion::{
        distributed_plan::rewrite::GroupByFieldVisitor,
        udf::{
            MATCH_FIELD_IGNORE_CASE_UDF_NAME, MATCH_FIELD_UDF_NAME, STR_MATCH_UDF_IGNORE_CASE_NAME,
            STR_MATCH_UDF_NAME,
        },
    },
    sql::{
        schema::{generate_schema_fields, generate_select_star_schema, has_original_column},
        visitor::{
            add_o2_id::AddO2IdVisitor, add_timestamp::AddTimestampVisitor, column::ColumnVisitor,
            index::IndexVisitor, index_optimize::IndexOptimizeModeVisitor, match_all::MatchVisitor,
            partition_column::PartitionColumnVisitor, prefix_column::PrefixColumnVisitor,
        },
    },
    utils::trim_quotes,
};

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

fn is_complex_query(statement: &mut Statement) -> bool {
    let mut visitor = ComplexQueryVisitor::new();
    let _ = statement.visit(&mut visitor);
    visitor.is_complex
}

// check if the query is complex query
// 1. has subquery
// 2. has join
// 3. has group by
// 4. has aggregate
// 5. has SetOperation(UNION/EXCEPT/INTERSECT of two queries)
// 6. has distinct
// 7. has wildcard
struct ComplexQueryVisitor {
    pub is_complex: bool,
}

impl ComplexQueryVisitor {
    fn new() -> Self {
        Self { is_complex: false }
    }
}

impl VisitorMut for ComplexQueryVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        match query.body.as_ref() {
            sqlparser::ast::SetExpr::Select(select) => {
                // check if has group by
                match select.group_by {
                    GroupByExpr::Expressions(ref expr, _) => self.is_complex = !expr.is_empty(),
                    _ => self.is_complex = true,
                }
                // check if has join
                if select.from.len() > 1 || select.from.iter().any(|from| !from.joins.is_empty()) {
                    self.is_complex = true;
                }
                if select.distinct.is_some() {
                    self.is_complex = true;
                }
                if self.is_complex {
                    return ControlFlow::Break(());
                }
            }
            // check if SetOperation
            sqlparser::ast::SetExpr::SetOperation { .. } => {
                self.is_complex = true;
                return ControlFlow::Break(());
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        match expr {
            // check if has subquery
            Expr::Subquery(_) | Expr::Exists { .. } | Expr::InSubquery { .. } => {
                self.is_complex = true;
            }
            // check if has aggregate function or window function
            Expr::Function(func) => {
                if AGGREGATE_UDF_LIST
                    .contains(&trim_quotes(&func.name.to_string().to_lowercase()).as_str())
                    || func.filter.is_some()
                    || func.over.is_some()
                    || !func.within_group.is_empty()
                {
                    self.is_complex = true;
                }
            }
            // check select * from table
            Expr::Wildcard(_) => self.is_complex = true,
            _ => {}
        }
        if self.is_complex {
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
}

#[derive(Debug)]
struct HistogramIntervalVisitor {
    pub interval: Option<i64>,
    time_range: Option<(i64, i64)>,
}

impl HistogramIntervalVisitor {
    fn new(time_range: Option<(i64, i64)>) -> Self {
        Self {
            interval: None,
            time_range,
        }
    }
}

impl VisitorMut for HistogramIntervalVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if let Expr::Function(func) = expr
            && func.name.to_string().eq_ignore_ascii_case("histogram")
        {
            if let FunctionArguments::List(list) = &func.args {
                let mut args = list.args.iter();
                // first is field
                let _ = args.next();
                // second is interval
                let interval = if let Some(interval) = args.next() {
                    interval
                        .to_string()
                        .trim_matches(|v| v == '\'' || v == '"')
                        .to_string()
                } else {
                    generate_histogram_interval(self.time_range).to_string()
                };
                self.interval = match convert_histogram_interval_to_seconds(&interval) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        log::error!("{e:?}");
                        Some(0)
                    }
                };
            }
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
}

struct TrackTotalHitsVisitor {}

impl TrackTotalHitsVisitor {
    fn new() -> Self {
        Self {}
    }
}

impl VisitorMut for TrackTotalHitsVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        match query.body.as_mut() {
            SetExpr::Select(select) => {
                let (field_expr, duplicate_treatment) = if select.distinct.is_some() {
                    match select.projection.first() {
                        Some(SelectItem::UnnamedExpr(expr)) => (
                            FunctionArgExpr::Expr(expr.clone()),
                            Some(DuplicateTreatment::Distinct),
                        ),
                        Some(SelectItem::ExprWithAlias { expr, alias: _ }) => (
                            FunctionArgExpr::Expr(expr.clone()),
                            Some(DuplicateTreatment::Distinct),
                        ),
                        _ => (FunctionArgExpr::Wildcard, None),
                    }
                } else {
                    (FunctionArgExpr::Wildcard, None)
                };

                select.group_by = GroupByExpr::Expressions(vec![], vec![]);
                select.having = None;
                select.sort_by = vec![];
                select.projection = vec![SelectItem::ExprWithAlias {
                    expr: Expr::Function(Function {
                        name: ObjectName(vec![ObjectNamePart::Identifier(Ident::new("count"))]),
                        parameters: FunctionArguments::None,
                        args: FunctionArguments::List(FunctionArgumentList {
                            args: vec![FunctionArg::Unnamed(field_expr)],
                            duplicate_treatment,
                            clauses: vec![],
                        }),
                        filter: None,
                        null_treatment: None,
                        over: None,
                        within_group: vec![],
                        uses_odbc_syntax: false,
                    }),
                    alias: Ident::new("zo_sql_num"),
                }];
                select.distinct = None;
                query.order_by = None;
            }
            SetExpr::SetOperation { .. } => {
                let select = Box::new(SetExpr::Select(Box::new(Select {
                    select_token: AttachedToken::empty(),
                    distinct: None,
                    top: None,
                    top_before_distinct: false,
                    projection: vec![SelectItem::ExprWithAlias {
                        expr: Expr::Function(Function {
                            name: ObjectName(vec![ObjectNamePart::Identifier(Ident::new("count"))]),
                            parameters: FunctionArguments::None,
                            args: FunctionArguments::List(FunctionArgumentList {
                                args: vec![FunctionArg::Unnamed(FunctionArgExpr::Wildcard)],
                                duplicate_treatment: None,
                                clauses: vec![],
                            }),
                            filter: None,
                            null_treatment: None,
                            over: None,
                            within_group: vec![],
                            uses_odbc_syntax: false,
                        }),
                        alias: Ident::new("zo_sql_num"),
                    }],
                    into: None,
                    from: vec![TableWithJoins {
                        relation: TableFactor::Derived {
                            lateral: false,
                            subquery: Box::new(query.clone()),
                            alias: None,
                        },
                        joins: vec![],
                    }],
                    lateral_views: vec![],
                    selection: None,
                    group_by: GroupByExpr::Expressions(vec![], vec![]),
                    having: None,
                    prewhere: None,
                    sort_by: vec![],
                    cluster_by: vec![],
                    distribute_by: vec![],
                    named_window: vec![],
                    qualify: None,
                    window_before_qualify: false,
                    connect_by: None,
                    value_table_mode: None,
                    flavor: SelectFlavor::Standard,
                })));
                *query = Query {
                    with: None,
                    body: select,
                    order_by: None,
                    limit: None,
                    offset: None,
                    fetch: None,
                    limit_by: vec![],
                    for_clause: None,
                    locks: vec![],
                    settings: None,
                    format_clause: None,
                };
            }
            _ => {}
        }
        ControlFlow::Break(())
    }
}

struct ReplaceApproxPercentiletVisitor {}

impl ReplaceApproxPercentiletVisitor {
    fn new() -> Self {
        Self {}
    }
}

impl VisitorMut for ReplaceApproxPercentiletVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if let Expr::Function(func) = expr {
            if !func.within_group.is_empty() {
                return ControlFlow::Continue(());
            }
            let name = func.name.to_string().to_lowercase();
            if name == "approx_percentile_cont" {
                let (first, others) = splite_function_args(&func.args);
                *expr = Expr::Function(Function {
                    name: ObjectName(vec![ObjectNamePart::Identifier(Ident::new(
                        "approx_percentile_cont",
                    ))]),
                    parameters: FunctionArguments::None,
                    args: FunctionArguments::List(FunctionArgumentList {
                        args: others,
                        duplicate_treatment: None,
                        clauses: vec![],
                    }),
                    filter: None,
                    null_treatment: None,
                    over: None,
                    within_group: vec![convert_args_to_order_expr(first)],
                    uses_odbc_syntax: false,
                });
            } else if name == "approx_percentile_cont_with_weight" {
                let (first, others) = splite_function_args(&func.args);
                *expr = Expr::Function(Function {
                    name: ObjectName(vec![ObjectNamePart::Identifier(Ident::new(
                        "approx_percentile_cont_with_weight",
                    ))]),
                    parameters: FunctionArguments::None,
                    args: FunctionArguments::List(FunctionArgumentList {
                        args: others,
                        duplicate_treatment: None,
                        clauses: vec![],
                    }),
                    filter: None,
                    null_treatment: None,
                    over: None,
                    within_group: vec![convert_args_to_order_expr(first)],
                    uses_odbc_syntax: false,
                });
            }
        }
        ControlFlow::Continue(())
    }
}

fn splite_function_args(args: &FunctionArguments) -> (FunctionArg, Vec<FunctionArg>) {
    match args {
        FunctionArguments::List(list) => {
            let (first, others) = list.args.split_first().unwrap();
            (first.clone(), others.to_vec())
        }
        _ => {
            log::error!("Unsupported function arguments: {:?}", args);
            (FunctionArg::Unnamed(FunctionArgExpr::Wildcard), vec![])
        }
    }
}

fn convert_args_to_order_expr(args: FunctionArg) -> OrderByExpr {
    let expr = convert_function_args_to_expr(args);
    OrderByExpr {
        expr: expr.clone(),
        options: OrderByOptions {
            asc: None,
            nulls_first: None,
        },
        with_fill: None,
    }
}

fn convert_function_args_to_expr(args: FunctionArg) -> Expr {
    match args {
        FunctionArg::Named {
            name: _,
            arg: FunctionArgExpr::Expr(arg),
            operator: _,
        } => arg,
        FunctionArg::Named {
            name: _,
            arg: FunctionArgExpr::Wildcard,
            operator: _,
        } => Expr::Wildcard(AttachedToken::empty()),
        FunctionArg::Unnamed(FunctionArgExpr::Expr(arg)) => arg,
        FunctionArg::Unnamed(FunctionArgExpr::Wildcard) => Expr::Wildcard(AttachedToken::empty()),
        _ => {
            log::error!("Unsupported function argument: {:?}", args);
            Expr::Wildcard(AttachedToken::empty())
        }
    }
}

/// Utility macro to generate microsecond-duration pairs concisely
macro_rules! intervals {
    ($(($unit:tt, $amount:expr, $label:expr)),+ $(,)?) => {
        [
            $((intervals!(@unit $unit)($amount).num_microseconds().unwrap(), $label)),+
        ]
    };

    (@unit h) => { chrono::Duration::hours };
    (@unit m) => { chrono::Duration::minutes };
}

pub fn generate_histogram_interval(time_range: Option<(i64, i64)>) -> &'static str {
    let Some((start, end)) = time_range else {
        return "1 hour";
    };
    if (start, end).eq(&(0, 0)) {
        return "1 hour";
    }
    let duration = end - start;

    const INTERVALS: [(i64, &str); 10] = intervals![
        (h, 24 * 60, "1 day"),
        (h, 24 * 30, "12 hour"),
        (h, 24 * 28, "6 hour"),
        (h, 24 * 21, "3 hour"),
        (h, 24 * 15, "2 hour"),
        (h, 6, "1 hour"),
        (h, 2, "1 minute"),
        (h, 1, "30 second"),
        (m, 30, "15 second"),
        (m, 15, "10 second"),
    ];

    for (time, interval) in INTERVALS.iter() {
        if duration >= *time {
            return interval;
        }
    }
    "10 second"
}

pub fn convert_histogram_interval_to_seconds(interval: &str) -> Result<i64, Error> {
    let interval = interval.trim();
    let pos = interval
        .find(|c: char| !c.is_numeric())
        .ok_or_else(|| Error::Message(format!("Invalid interval format: '{interval}'")))?;

    let (num_str, unit_str) = interval.split_at(pos);
    let num = num_str.parse::<i64>().map_err(|_| {
        Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
            "Invalid number format".to_string(),
        ))
    })?;

    let unit = unit_str.trim().to_lowercase();
    let seconds = match unit.as_str() {
        "second" | "seconds" | "s" | "secs" | "sec" => num,
        "minute" | "minutes" | "m" | "mins" | "min" => num * 60,
        "hour" | "hours" | "h" | "hrs" | "hr" => num * 3600,
        "day" | "days" | "d" => num * 86400,
        _ => {
            return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                "Unsupported histogram interval unit".to_string(),
            )));
        }
    };

    Ok(seconds)
}

pub fn pickup_where(sql: &str) -> Result<Option<String>, Error> {
    // disable subquery, join, union, except, intersect, etc.
    let mut statement = Parser::parse_sql(&PostgreSqlDialect {}, sql)
        .map_err(|e| Error::Message(e.to_string()))?
        .pop()
        .unwrap();
    let mut visitor = PickupWhereVisitor::new();
    let _ = statement.visit(&mut visitor);
    if let Some(where_str) = visitor.where_str {
        return Ok(Some(where_str));
    }
    Ok(None)
}

struct PickupWhereVisitor {
    where_str: Option<String>,
}

impl PickupWhereVisitor {
    fn new() -> Self {
        Self { where_str: None }
    }
}

impl VisitorMut for PickupWhereVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if query.with.is_some() {
            self.where_str = None;
            return ControlFlow::Break(());
        }
        match query.body.as_ref() {
            sqlparser::ast::SetExpr::Select(select) => {
                if select.from.len() > 1
                    || select.from.iter().any(|from| {
                        !from.joins.is_empty()
                            || matches!(
                                from.relation,
                                TableFactor::Derived { .. } | TableFactor::Function { .. }
                            )
                    })
                {
                    self.where_str = None;
                    return ControlFlow::Break(());
                }

                if let Some(selection) = select.selection.as_ref() {
                    self.where_str = Some(selection.to_string());
                    return ControlFlow::Continue(());
                } else {
                    self.where_str = None;
                    return ControlFlow::Break(());
                }
            }
            sqlparser::ast::SetExpr::SetOperation { .. } => {
                self.where_str = None;
                return ControlFlow::Break(());
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        match expr {
            // check if has subquery
            Expr::Subquery(_) | Expr::Exists { .. } | Expr::InSubquery { .. } => {
                self.where_str = None;
                return ControlFlow::Break(());
            }
            _ => {}
        }
        ControlFlow::Continue(())
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

#[cfg(feature = "enterprise")]
struct ExtractKeyNamesVisitor {
    keys: Vec<String>,
    error: Option<Error>,
}

#[cfg(feature = "enterprise")]
impl ExtractKeyNamesVisitor {
    fn new() -> Self {
        Self {
            keys: Vec::new(),
            error: None,
        }
    }
}

#[cfg(feature = "enterprise")]
impl VisitorMut for ExtractKeyNamesVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if let Expr::Function(Function {
            name: ObjectName(names),
            args,
            ..
        }) = expr
        {
            // cipher functions will always be 1-part names
            if names.len() != 1 {
                return ControlFlow::Continue(());
            }
            let fname = names.first().unwrap();
            let fname = fname.as_ident().unwrap();
            if fname.value == ENCRYPT_UDF_NAME
                || fname.value == DECRYPT_UDF_NAME
                || fname.value == DECRYPT_SLOW_UDF_NAME
            {
                let list = match args {
                    FunctionArguments::List(list) => list,
                    _ => {
                        self.error = Some(Error::Message(
                            "invalid arguments to cipher function".to_string(),
                        ));
                        return ControlFlow::Continue(());
                    }
                };
                if list.args.len() < 2 {
                    self.error = Some(Error::Message(
                        "invalid number of arguments to cipher function, expected at least 2: column, key and optional path".to_string(),
                    ));
                    return ControlFlow::Continue(());
                }
                let arg = match &list.args[1] {
                    FunctionArg::Named { arg, .. } => arg,
                    FunctionArg::Unnamed(arg) => arg,
                    FunctionArg::ExprNamed { arg, .. } => arg,
                };
                match arg {
                    FunctionArgExpr::Expr(Expr::Value(ValueWithSpan {
                        value: Value::SingleQuotedString(s),
                        span: _,
                    })) => {
                        self.keys.push(s.to_owned());
                    }
                    _ => {
                        self.error = Some(Error::Message(
                            "key name must be a static string in cipher function".to_string(),
                        ));
                        return ControlFlow::Continue(());
                    }
                }
            }
        }
        ControlFlow::Continue(())
    }
}

#[cfg(feature = "enterprise")]
pub fn get_cipher_key_names(sql: &str) -> Result<Vec<String>, Error> {
    let dialect = &PostgreSqlDialect {};
    let mut statement = Parser::parse_sql(dialect, sql)
        .map_err(|e| Error::Message(e.to_string()))?
        .pop()
        .unwrap();
    let mut visitor = ExtractKeyNamesVisitor::new();
    let _ = statement.visit(&mut visitor);
    if let Some(e) = visitor.error {
        Err(e)
    } else {
        Ok(visitor.keys)
    }
}

/// check if the sql is complex query, if not, add ordering term by timestamp
pub fn check_or_add_order_by_timestamp(sql: &str, is_asc: bool) -> infra::errors::Result<String> {
    let mut statement = Parser::parse_sql(&PostgreSqlDialect {}, sql)
        .map_err(|e| Error::Message(e.to_string()))?
        .pop()
        .unwrap();
    if is_complex_query(&mut statement) {
        return Ok(sql.to_string());
    }
    let mut visitor = AddOrderingTermVisitor::new(TIMESTAMP_COL_NAME.to_string(), is_asc);
    let _ = statement.visit(&mut visitor);
    Ok(statement.to_string())
}

struct AddOrderingTermVisitor {
    field: String,
    is_asc: bool,
}

impl AddOrderingTermVisitor {
    fn new(field: String, is_asc: bool) -> Self {
        Self { field, is_asc }
    }
}

impl VisitorMut for AddOrderingTermVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if query.order_by.is_none() {
            query.order_by = Some(sqlparser::ast::OrderBy {
                kind: OrderByKind::Expressions(vec![OrderByExpr {
                    expr: Expr::Identifier(Ident::new(self.field.clone())),
                    with_fill: None,
                    options: sqlparser::ast::OrderByOptions {
                        asc: Some(self.is_asc),
                        nulls_first: None,
                    },
                }]),
                interpolate: None,
            });
        }
        ControlFlow::Continue(())
    }
}

pub fn add_new_filters_with_and_operator(
    sql: &str,
    filters: HashMap<String, String>,
) -> infra::errors::Result<String> {
    if sql.is_empty() || filters.is_empty() {
        return Ok(sql.to_string());
    }

    let mut statement = Parser::parse_sql(&PostgreSqlDialect {}, sql)
        .map_err(|e| Error::Message(e.to_string()))?
        .pop()
        .unwrap();
    if is_complex_query(&mut statement) {
        return Ok(sql.to_string());
    }
    let mut visitor = AddNewFiltersWithAndOperatorVisitor::new(filters);
    let _ = statement.visit(&mut visitor);
    Ok(statement.to_string())
}

struct AddNewFiltersWithAndOperatorVisitor {
    filters: HashMap<String, String>,
}

impl AddNewFiltersWithAndOperatorVisitor {
    fn new(filters: HashMap<String, String>) -> Self {
        Self { filters }
    }

    fn build_selection(&mut self) -> Option<Expr> {
        if self.filters.is_empty() {
            return None;
        }
        let mut exprs = Vec::with_capacity(self.filters.len());
        let mut keys = self.filters.keys().collect::<Vec<_>>();
        keys.sort();
        for key in keys {
            let value = self.filters.get(key).unwrap();
            exprs.push(Expr::BinaryOp {
                left: Box::new(Expr::Identifier(Ident::new(key.to_string()))),
                op: BinaryOperator::Eq,
                right: Box::new(Expr::Value(ValueWithSpan {
                    value: Value::SingleQuotedString(value.to_string()),
                    span: Span::empty(),
                })),
            });
        }
        let exprs = exprs.iter().collect();
        conjunction(exprs)
    }
}

impl VisitorMut for AddNewFiltersWithAndOperatorVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        let Some(filter_exprs) = self.build_selection() else {
            return ControlFlow::Break(());
        };
        match query.body.as_mut() {
            SetExpr::Select(statement) => match statement.selection.as_mut() {
                None => {
                    statement.selection = Some(filter_exprs);
                }
                Some(selection) => {
                    statement.selection = Some(Expr::BinaryOp {
                        left: if matches!(
                            selection,
                            Expr::BinaryOp {
                                op: BinaryOperator::Or,
                                ..
                            }
                        ) {
                            Box::new(Expr::Nested(Box::new(selection.clone())))
                        } else {
                            Box::new(selection.clone())
                        },
                        op: BinaryOperator::And,
                        // the right side must be AND so don't need to check
                        right: Box::new(filter_exprs),
                    });
                }
            },
            _ => {
                return ControlFlow::Break(());
            }
        };
        ControlFlow::Continue(())
    }
}

// replace _o2_all_ with true
struct RemoveDashboardAllVisitor {}

impl RemoveDashboardAllVisitor {
    fn new() -> Self {
        Self {}
    }
}

impl VisitorMut for RemoveDashboardAllVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        let placeholder = get_config().common.dashboard_placeholder.to_string();
        match expr {
            Expr::BinaryOp {
                left,
                op:
                    BinaryOperator::Eq
                    | BinaryOperator::GtEq
                    | BinaryOperator::LtEq
                    | BinaryOperator::Gt
                    | BinaryOperator::Lt,
                right,
            } => {
                if is_eq_placeholder(left.as_ref(), &placeholder)
                    || is_eq_placeholder(right.as_ref(), &placeholder)
                {
                    *expr = expr_boolean(true);
                }
            }
            // Not equal
            Expr::BinaryOp {
                left,
                op: BinaryOperator::NotEq,
                right,
            } => {
                if is_eq_placeholder(left.as_ref(), &placeholder)
                    || is_eq_placeholder(right.as_ref(), &placeholder)
                {
                    *expr = expr_boolean(false);
                }
            }
            // Like
            Expr::Like {
                pattern,
                negated: false,
                ..
            }
            | Expr::ILike {
                pattern,
                negated: false,
                ..
            } => {
                if is_eq_placeholder(pattern.as_ref(), &placeholder) {
                    *expr = expr_boolean(true);
                }
            }
            // Not Like
            Expr::Like {
                pattern,
                negated: true,
                ..
            }
            | Expr::ILike {
                pattern,
                negated: true,
                ..
            } => {
                if is_eq_placeholder(pattern.as_ref(), &placeholder) {
                    *expr = expr_boolean(false);
                }
            }
            // In list
            Expr::InList { list, negated, .. } if !(*negated) => {
                for item in list.iter() {
                    if is_eq_placeholder(item, &placeholder) {
                        *expr = expr_boolean(true);
                        break;
                    }
                }
            }
            // Not in list
            Expr::InList { list, negated, .. } if *negated => {
                for item in list.iter() {
                    if is_eq_placeholder(item, &placeholder) {
                        *expr = expr_boolean(false);
                        break;
                    }
                }
            }
            Expr::Function(func) => {
                let f = func.name.to_string().to_lowercase();
                if (f == STR_MATCH_UDF_NAME
                    || f == STR_MATCH_UDF_IGNORE_CASE_NAME
                    || f == MATCH_FIELD_UDF_NAME
                    || f == MATCH_FIELD_IGNORE_CASE_UDF_NAME)
                    && let FunctionArguments::List(list) = &func.args
                    && list.args.len() == 2
                {
                    let value = trim_quotes(list.args[1].to_string().as_str());
                    if *value == placeholder {
                        *expr = expr_boolean(true);
                    }
                }
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }
}

// get group by fields from sql, if sql is not a single table query, return empty vector
#[allow(dead_code)]
pub async fn get_group_by_fields(sql: &Sql) -> Result<Vec<String>, Error> {
    if sql.schemas.len() != 1 {
        return Ok(vec![]);
    }
    let sql_arc = Arc::new(sql.clone());
    let ctx = generate_context(&Request::default(), &sql_arc, 0).await?;
    register_table(&ctx, &sql_arc).await?;
    let plan = ctx.state().create_logical_plan(&sql_arc.sql).await?;
    let physical_plan = ctx.state().create_physical_plan(&plan).await?;

    // visit group by fields
    let mut group_by_visitor = GroupByFieldVisitor::new();
    physical_plan.visit(&mut group_by_visitor)?;
    Ok(group_by_visitor.get_group_by_fields())
}

fn expr_boolean(value: bool) -> Expr {
    Expr::Value(ValueWithSpan {
        value: Value::Boolean(value),
        span: Span::empty(),
    })
}

fn is_eq_placeholder(expr: &Expr, placeholder: &str) -> bool {
    if let Expr::Value(ValueWithSpan {
        value: Value::SingleQuotedString(value),
        span: _,
    }) = expr
        && value == placeholder
    {
        true
    } else {
        false
    }
}

#[cfg(test)]
mod tests {

    use sqlparser::dialect::GenericDialect;

    use super::*;

    #[test]
    fn test_convert_histogram_interval_full_words() {
        // Test full word formats
        assert_eq!(
            convert_histogram_interval_to_seconds("1 second").unwrap(),
            1
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("1 seconds").unwrap(),
            1
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("5 minute").unwrap(),
            300
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("5 minutes").unwrap(),
            300
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("2 hour").unwrap(),
            7200
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("2 hours").unwrap(),
            7200
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("1 day").unwrap(),
            86400
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("1 days").unwrap(),
            86400
        );
        assert!(convert_histogram_interval_to_seconds("1 week").is_err()); // week is not supported
        assert!(convert_histogram_interval_to_seconds("1 weeks").is_err()); // weeks is not supported
        assert!(convert_histogram_interval_to_seconds("1 month").is_err()); // month is not supported
        assert!(convert_histogram_interval_to_seconds("1 months").is_err()); // months is not supported
        assert!(convert_histogram_interval_to_seconds("1 year").is_err()); // year is not supported
        assert!(convert_histogram_interval_to_seconds("1 years").is_err()); // years is not
        // supported
    }

    #[test]
    fn test_convert_histogram_interval_spacing_variants() {
        // Test different spacing formats
        assert_eq!(
            convert_histogram_interval_to_seconds("10second").unwrap(),
            10
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("10 second").unwrap(),
            10
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("10  second").unwrap(),
            10
        ); // double space
        assert_eq!(
            convert_histogram_interval_to_seconds("10\tsecond").unwrap(),
            10
        ); // tab
        assert_eq!(
            convert_histogram_interval_to_seconds("10seconds").unwrap(),
            10
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("10 seconds").unwrap(),
            10
        );
    }

    #[test]
    fn test_convert_histogram_interval_larger_numbers() {
        // Test larger numbers
        assert_eq!(
            convert_histogram_interval_to_seconds("60 seconds").unwrap(),
            60
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("90 minutes").unwrap(),
            5400
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("24 hours").unwrap(),
            86400
        );
        assert_eq!(
            convert_histogram_interval_to_seconds("30 days").unwrap(),
            2592000
        );
        assert!(convert_histogram_interval_to_seconds("52 weeks").is_err());
    }

    #[test]
    fn test_convert_histogram_interval_invalid_inputs() {
        // Test invalid inputs
        assert!(convert_histogram_interval_to_seconds("").is_err());
        assert!(convert_histogram_interval_to_seconds("invalid").is_err());
        assert!(convert_histogram_interval_to_seconds("5x").is_err());
        assert!(convert_histogram_interval_to_seconds("s").is_err());
        assert!(convert_histogram_interval_to_seconds("-1s").is_err());
        assert!(convert_histogram_interval_to_seconds("1.5 seconds").is_err());
        assert!(convert_histogram_interval_to_seconds("second").is_err());
        assert!(convert_histogram_interval_to_seconds(" 5 seconds").is_ok()); // leading space
        assert!(convert_histogram_interval_to_seconds("5 seconds ").is_ok()); // trailing space
        assert!(convert_histogram_interval_to_seconds("five seconds").is_err());
    }

    #[test]
    fn test_convert_histogram_interval_edge_cases() {
        // Test edge cases
        assert_eq!(
            convert_histogram_interval_to_seconds("0 seconds").unwrap(),
            0
        );
        assert_eq!(convert_histogram_interval_to_seconds("0s").unwrap(), 0);
        assert_eq!(
            convert_histogram_interval_to_seconds("1000000 seconds").unwrap(),
            1000000
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_empty_sql() {
        // Test adding filters to an empty SQL string
        let sql = "";
        let filters = HashMap::from([
            ("column1".to_string(), "'value1'".to_string()),
            ("column2".to_string(), "10".to_string()),
        ]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should create a basic WHERE clause with the filters
        assert_eq!(result, "");
    }

    #[test]
    fn test_add_new_filters_with_and_operator_simple_select() {
        // Test adding filters to a simple SELECT statement
        let sql = "SELECT * FROM table1";
        let filters = HashMap::from([
            ("column1".to_string(), "value1".to_string()),
            ("column2".to_string(), "10".to_string()),
        ]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should add a WHERE clause
        assert_eq!(
            result,
            "SELECT * FROM table1 WHERE column1 = 'value1' AND column2 = '10'"
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_existing_where() {
        // Test adding filters to a query that already has a WHERE clause
        let sql = "SELECT * FROM table1 WHERE column3 < 5";
        let filters = HashMap::from([
            ("column1".to_string(), "value1".to_string()),
            ("column2".to_string(), "10".to_string()),
        ]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should add to the existing WHERE clause with AND
        assert_eq!(
            result,
            "SELECT * FROM table1 WHERE column3 < 5 AND column1 = 'value1' AND column2 = '10'"
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_multiple_filters_and_or_condition() {
        // Test adding filters to a query with multiple filters and OR condition
        let sql = "SELECT * FROM table1 WHERE column1 = 'value1' OR column2 = 'value2'";
        let filters = HashMap::from([("column3".to_string(), "value3".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should add WHERE before ORDER BY
        assert_eq!(
            result,
            "SELECT * FROM table1 WHERE (column1 = 'value1' OR column2 = 'value2') AND column3 = 'value3'"
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_multiple_filters_and_and_condition() {
        // Test adding filters to a query with multiple filters and AND condition
        let sql = "SELECT * FROM table1 WHERE column1 = 'value1' AND column2 = 'value2'";
        let filters = HashMap::from([("column3".to_string(), "value3".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should add WHERE before ORDER BY
        assert_eq!(
            result,
            "SELECT * FROM table1 WHERE column1 = 'value1' AND column2 = 'value2' AND column3 = 'value3'"
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_empty_filters() {
        // Test with empty filters array
        let sql = "SELECT * FROM table1";
        let filters: HashMap<String, String> = HashMap::new();

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should return the original SQL unchanged
        assert_eq!(result, sql);
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_group_by() {
        // Test adding filters to a query with GROUP BY
        let sql = "SELECT column1, COUNT(*) FROM table1 GROUP BY column1";
        let filters = HashMap::from([("column2".to_string(), "value2".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should add WHERE before GROUP BY
        assert_eq!(result, sql.to_string());
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_order_by() {
        // Test adding filters to a query with ORDER BY
        let sql = "SELECT * FROM table1 ORDER BY column1 DESC";
        let filters = HashMap::from([("column2".to_string(), "value2".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should add WHERE before ORDER BY
        assert_eq!(
            result,
            "SELECT * FROM table1 WHERE column2 = 'value2' ORDER BY column1 DESC"
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_limit() {
        // Test adding filters to a query with LIMIT
        let sql = "SELECT * FROM table1 LIMIT 10";
        let filters = HashMap::from([("column1".to_string(), "value1".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // Should add WHERE before LIMIT
        assert_eq!(
            result,
            "SELECT * FROM table1 WHERE column1 = 'value1' LIMIT 10"
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_complex_query() {
        // Test adding filters to a complex query
        let sql = "SELECT t1.column1, t2.column2 FROM table1 t1 JOIN table2 t2 ON t1.id = t2.id WHERE t1.status = 'active' GROUP BY t1.column1 ORDER BY t2.column2 LIMIT 20";
        let filters = HashMap::from([
            ("t1.region".to_string(), "west".to_string()),
            ("t2.value".to_string(), "100".to_string()),
        ]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // the function don't add WHERE for the aggregation query
        assert_eq!(result, sql.to_string());
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_having() {
        // Test adding filters to a query with HAVING
        let sql = "SELECT department, AVG(salary) FROM employees GROUP BY department HAVING AVG(salary) > 50000";
        let filters = HashMap::from([("department".to_string(), "'HR'".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // the function don't add WHERE for the aggregation query
        assert_eq!(result, sql.to_string());
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_subquery() {
        // Test adding filters to a query with a subquery
        let sql = "SELECT * FROM (SELECT id, name FROM users) AS u";
        let filters = HashMap::from([("u.id".to_string(), "100".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // we support subquery
        assert_eq!(
            result,
            "SELECT * FROM (SELECT id, name FROM users WHERE u.id = '100') AS u WHERE u.id = '100'"
        );
    }

    #[test]
    fn test_add_new_filters_with_and_operator_with_field_in_subquery() {
        // Test adding filters to a query with a subquery
        let sql = "SELECT * FROM users WHERE id IN (SELECT id FROM users)";
        let filters = HashMap::from([("id".to_string(), "100".to_string())]);

        let result = add_new_filters_with_and_operator(sql, filters).unwrap();

        // we support this type of query
        assert_eq!(result, sql.to_string());
    }

    #[test]
    fn test_remove_dashboard_all_visitor() {
        let sql = "select * from t where field1 = '_o2_all_'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_remove_dashboard_all_visitor_with_in_list() {
        let sql = "select * from t where field1 in ('_o2_all_')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_remove_dashboard_all_visitor_with_in_list_and_negated() {
        let sql = "select * from t where field1 not in ('_o2_all_')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE false";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_remove_dashboard_all_visitor_with_in_list_and_negated_and_other_filter() {
        let sql = "select * from t where field1 not in ('_o2_all_') and field2 = 'value2'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE false AND field2 = 'value2'";
        assert_eq!(statement.to_string(), expected);
    }

    // test multi and/or with _o2_all_
    #[test]
    fn test_remove_dashboard_all_visitor_with_multi_and_or_with_o2_all() {
        let sql = "select * from t where field1 = '_o2_all_' and (field2 = '_o2_all_' or field3 = '_o2_all_')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true AND (true OR true)";
        assert_eq!(statement.to_string(), expected);
    }

    // test _o2_all_ with like and not like
    #[test]
    fn test_remove_dashboard_all_visitor_with_like_and_not_like() {
        let sql = "select * from t where field1 like '_o2_all_' and field2 not like '_o2_all_'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true AND false";
        assert_eq!(statement.to_string(), expected);
    }

    // test _o2_all_ with like and not like
    #[test]
    fn test_remove_dashboard_all_visitor_with_like_and_not_like_and_other_filter() {
        let sql = "select * from t where field1 like '_o2_all_' and field2 not like '_o2_all_' and field3 = 'value3'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true AND false AND field3 = 'value3'";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_remove_dashboard_all_visitor_with_str_match_and_other_filter() {
        let sql = "select * from t where str_match(field1, '_o2_all_') and field2 = 'value2'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true AND field2 = 'value2'";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_remove_dashboard_all_visitor_with_match_field_and_other_filter() {
        let sql = "select * from t where match_field(field1, '_o2_all_') and field2 = 'value2'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        let expected = "SELECT * FROM t WHERE true AND field2 = 'value2'";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_histogram_interval_visitor() {
        // Test with time range and histogram function
        let sql = "SELECT histogram(_timestamp, '10 second') FROM logs";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let time_range = Some((1640995200000000, 1641081600000000)); // 2022-01-01 to 2022-01-02
        let mut histogram_interval_visitor = HistogramIntervalVisitor::new(time_range);
        let _ = statement.visit(&mut histogram_interval_visitor);

        // Should extract the interval from the histogram function
        assert_eq!(histogram_interval_visitor.interval, Some(10));
    }

    #[test]
    fn test_histogram_interval_visitor_with_zero_time_range() {
        // Test with zero time range
        let sql = "SELECT histogram(_timestamp) FROM logs";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let time_range = Some((0, 0));
        let mut histogram_interval_visitor = HistogramIntervalVisitor::new(time_range);
        let _ = statement.visit(&mut histogram_interval_visitor);

        // Should return default interval of 1 hour (3600 seconds)
        assert_eq!(histogram_interval_visitor.interval, Some(3600));
    }

    #[test]
    fn test_complex_query_visitor() {
        let sql = "SELECT * FROM users WHERE name IN (SELECT name FROM admins)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut complex_visitor = ComplexQueryVisitor::new();
        let _ = statement.visit(&mut complex_visitor);

        // Should detect complex query due to subquery
        assert!(complex_visitor.is_complex);
    }

    #[test]
    fn test_add_ordering_term_visitor() {
        let sql = "SELECT * FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut ordering_visitor = AddOrderingTermVisitor::new("name".to_string(), true);
        let _ = statement.visit(&mut ordering_visitor);

        // Should add ORDER BY clause
        let expected = "SELECT * FROM users ORDER BY name ASC";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_replace_approx_percentilet_visitor1() {
        let sql = "select approx_percentile_cont(a, 0.5) from stream";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut replace_approx_percentilet_visitor = ReplaceApproxPercentiletVisitor::new();
        let _ = statement.visit(&mut replace_approx_percentilet_visitor);
        assert_eq!(
            statement.to_string(),
            "SELECT approx_percentile_cont(0.5) WITHIN GROUP (ORDER BY a) FROM stream"
        );
    }

    #[test]
    fn test_replace_approx_percentilet_visitor2() {
        let sql = "select approx_percentile_cont(arrow_cast(a, 'int'), 0.5) from stream";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut replace_approx_percentilet_visitor = ReplaceApproxPercentiletVisitor::new();
        let _ = statement.visit(&mut replace_approx_percentilet_visitor);
        assert_eq!(
            statement.to_string(),
            "SELECT approx_percentile_cont(0.5) WITHIN GROUP (ORDER BY arrow_cast(a, 'int')) FROM stream"
        );
    }

    #[test]
    fn test_replace_approx_percentilet_visitor3() {
        let sql = "SELECT approx_percentile_cont(0.5) WITHIN GROUP (ORDER BY a) FROM stream";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut replace_approx_percentilet_visitor = ReplaceApproxPercentiletVisitor::new();
        let _ = statement.visit(&mut replace_approx_percentilet_visitor);
        assert_eq!(
            statement.to_string(),
            "SELECT approx_percentile_cont(0.5) WITHIN GROUP (ORDER BY a) FROM stream"
        );
    }

    #[test]
    fn test_replace_approx_percentilet_visitor4() {
        let sql = "select approx_percentile_cont(arrow_cast(a, 'int') / 1000, 0.5) from stream";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut replace_approx_percentilet_visitor = ReplaceApproxPercentiletVisitor::new();
        let _ = statement.visit(&mut replace_approx_percentilet_visitor);
        assert_eq!(
            statement.to_string(),
            "SELECT approx_percentile_cont(0.5) WITHIN GROUP (ORDER BY arrow_cast(a, 'int') / 1000) FROM stream"
        );
    }

    #[test]
    fn test_replace_approx_percentilet_visitor5() {
        let sql = "select approx_percentile_cont(CAST(json_get_str(array_element(cast_to_arr(spath(log, 'error')), 1), 'code') AS INT), 0.5) from stream";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut replace_approx_percentilet_visitor = ReplaceApproxPercentiletVisitor::new();
        let _ = statement.visit(&mut replace_approx_percentilet_visitor);
        assert_eq!(
            statement.to_string(),
            "SELECT approx_percentile_cont(0.5) WITHIN GROUP (ORDER BY CAST(json_get_str(array_element(cast_to_arr(spath(log, 'error')), 1), 'code') AS INT)) FROM stream"
        );
    }

    #[test]
    fn test_pickup_where_normal_sql() {
        // Test normal SQL with WHERE clause
        let sql = "SELECT * FROM logs WHERE level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, Some("level = 'error'".to_string()));

        // Test normal SQL with complex WHERE clause
        let sql = "SELECT * FROM logs WHERE level = 'error' AND timestamp > 1234567890";
        let result = pickup_where(sql).unwrap();
        assert_eq!(
            result,
            Some("level = 'error' AND timestamp > 1234567890".to_string())
        );

        // Test normal SQL with OR condition
        let sql = "SELECT * FROM logs WHERE level = 'error' OR level = 'warn'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(
            result,
            Some("level = 'error' OR level = 'warn'".to_string())
        );

        // Test normal SQL with IN clause
        let sql = "SELECT * FROM logs WHERE level IN ('error', 'warn', 'info')";
        let result = pickup_where(sql).unwrap();
        assert_eq!(
            result,
            Some("level IN ('error', 'warn', 'info')".to_string())
        );

        // Test normal SQL with LIKE clause
        let sql = "SELECT * FROM logs WHERE message LIKE '%error%'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, Some("message LIKE '%error%'".to_string()));
    }

    #[test]
    fn test_pickup_where_no_where_clause() {
        // Test SQL without WHERE clause
        let sql = "SELECT * FROM logs";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with only SELECT and FROM
        let sql = "SELECT id, name FROM users";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_pickup_where_with_joins() {
        // Test SQL with JOIN - should return None
        let sql = "SELECT * FROM logs l JOIN users u ON l.user_id = u.id WHERE l.level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with multiple FROM tables - should return None
        let sql = "SELECT * FROM logs, users WHERE logs.user_id = users.id";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with LEFT JOIN - should return None
        let sql =
            "SELECT * FROM logs l LEFT JOIN users u ON l.user_id = u.id WHERE l.level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with INNER JOIN - should return None
        let sql =
            "SELECT * FROM logs l INNER JOIN users u ON l.user_id = u.id WHERE l.level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_pickup_where_with_subqueries() {
        // Test SQL with subquery in WHERE - should return None
        let sql = "SELECT * FROM logs WHERE user_id IN (SELECT id FROM users WHERE active = true)";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with EXISTS subquery - should return None
        let sql =
            "SELECT * FROM logs WHERE EXISTS (SELECT 1 FROM users WHERE users.id = logs.user_id)";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with subquery in FROM - should return None
        let sql = "SELECT * FROM (SELECT * FROM logs WHERE level = 'error') sub WHERE sub.timestamp > 1234567890";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        let sql = "with t1 as (select log, message, kubernetes_namespace_name from default where kubernetes_namespace_name = 'ziox') select * from t1;";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        let sql = "with t1 as (select log, message, kubernetes_namespace_name from default) select * from t1 where kubernetes_namespace_name = 'ziox';";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_pickup_where_with_union() {
        // Test SQL with UNION - should return None
        let sql = "SELECT * FROM logs WHERE level = 'error' UNION SELECT * FROM logs WHERE level = 'warn'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with UNION ALL - should return None
        let sql = "SELECT * FROM logs WHERE level = 'error' UNION ALL SELECT * FROM logs WHERE level = 'warn'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with INTERSECT - should return None
        let sql = "SELECT * FROM logs WHERE level = 'error' INTERSECT SELECT * FROM logs WHERE level = 'warn'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);

        // Test SQL with EXCEPT - should return None
        let sql = "SELECT * FROM logs WHERE level = 'error' EXCEPT SELECT * FROM logs WHERE level = 'warn'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, None);
    }

    #[test]
    fn test_pickup_where_complex_where_clauses() {
        // Test complex WHERE with parentheses
        let sql = "SELECT * FROM logs WHERE (level = 'error' OR level = 'warn') AND timestamp > 1234567890";
        let result = pickup_where(sql).unwrap();
        assert_eq!(
            result,
            Some("(level = 'error' OR level = 'warn') AND timestamp > 1234567890".to_string())
        );

        // Test WHERE with function calls
        let sql = "SELECT * FROM logs WHERE LENGTH(message) > 100 AND level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(
            result,
            Some("LENGTH(message) > 100 AND level = 'error'".to_string())
        );

        // Test WHERE with BETWEEN
        let sql = "SELECT * FROM logs WHERE timestamp BETWEEN 1234567890 AND 1234567999";
        let result = pickup_where(sql).unwrap();
        assert_eq!(
            result,
            Some("timestamp BETWEEN 1234567890 AND 1234567999".to_string())
        );

        // Test WHERE with IS NULL
        let sql = "SELECT * FROM logs WHERE user_id IS NULL AND level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(
            result,
            Some("user_id IS NULL AND level = 'error'".to_string())
        );

        // Test WHERE with IS NOT NULL
        let sql = "SELECT * FROM logs WHERE user_id IS NOT NULL";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, Some("user_id IS NOT NULL".to_string()));
    }

    #[test]
    fn test_pickup_where_edge_cases() {
        // Test SQL with table alias but no joins
        let sql = "SELECT * FROM logs l WHERE l.level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, Some("l.level = 'error'".to_string()));

        // Test SQL with quoted identifiers
        let sql = "SELECT * FROM \"logs\" WHERE \"level\" = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, Some("\"level\" = 'error'".to_string()));

        // Test SQL with schema prefix
        let sql = "SELECT * FROM public.logs WHERE level = 'error'";
        let result = pickup_where(sql).unwrap();
        assert_eq!(result, Some("level = 'error'".to_string()));
    }
}
