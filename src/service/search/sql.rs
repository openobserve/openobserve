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

use arrow_schema::{DataType, Field, FieldRef};
use config::{
    ALL_VALUES_COL_NAME, ID_COL_NAME, ORIGINAL_DATA_COL_NAME, TIMESTAMP_COL_NAME, get_config,
    meta::{
        inverted_index::InvertedIndexOptimizeMode,
        search::SearchEventType,
        sql::{OrderBy, Sql as MetaSql, TableReferenceExt, resolve_stream_names_with_type},
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
    schema::{
        SchemaCache, get_stream_setting_defined_schema_fields, get_stream_setting_fts_fields,
        get_stream_setting_index_fields, unwrap_stream_settings,
    },
};
use once_cell::sync::Lazy;
use proto::cluster_rpc::SearchQuery;
use regex::Regex;
use sqlparser::{
    ast::{
        BinaryOperator, DuplicateTreatment, Expr, Function, FunctionArg, FunctionArgExpr,
        FunctionArgumentList, FunctionArguments, GroupByExpr, Ident, ObjectName, ObjectNamePart,
        OrderByExpr, OrderByKind, Query, Select, SelectFlavor, SelectItem, SetExpr, Statement,
        TableFactor, TableWithJoins, Value, ValueWithSpan, VisitMut, VisitorMut,
        helpers::attached_token::AttachedToken,
    },
    dialect::PostgreSqlDialect,
    parser::Parser,
    tokenizer::Span,
};

#[cfg(feature = "enterprise")]
use super::datafusion::udf::cipher_udf::{DECRYPT_UDF_NAME, ENCRYPT_UDF_NAME};
use super::{
    datafusion::udf::match_all_udf::{FUZZY_MATCH_ALL_UDF_NAME, MATCH_ALL_UDF_NAME},
    index::{Condition, IndexCondition, get_index_condition_from_expr},
    request::Request,
    utils::{conjunction, is_field, is_value, split_conjunction, trim_quotes},
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
    index::get_arg_name,
};

pub static RE_ONLY_SELECT: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)select[ ]+\*").unwrap());
pub static RE_SELECT_FROM: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i)SELECT (.*) FROM").unwrap());
pub static RE_WHERE: Lazy<Regex> = Lazy::new(|| Regex::new(r"(?i) where (.*)").unwrap());

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
    pub index_optimize_mode: Option<InvertedIndexOptimizeMode>,
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

        //********************Change the sql here*********************************//
        // 2. rewrite track_total_hits
        if query.track_total_hits {
            let mut trace_total_hits_visitor = TrackTotalHitsVisitor::new();
            let _ = statement.visit(&mut trace_total_hits_visitor);
        }

        // 3. rewrite all filter that include DASHBOARD_ALL with true
        let mut remove_dashboard_all_visitor = RemoveDashboardAllVisitor::new();
        let _ = statement.visit(&mut remove_dashboard_all_visitor);
        //********************Change the sql here*********************************//

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
        let use_inverted_index = column_visitor.use_inverted_index;

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

        //********************Change the sql here*********************************//
        // 11. add _timestamp and _o2_id if need
        if !is_complex_query(&mut statement) {
            let mut add_timestamp_visitor = AddTimestampVisitor::new();
            let _ = statement.visit(&mut add_timestamp_visitor);
            if o2_id_is_needed(&used_schemas, &search_event_type) {
                let mut add_o2_id_visitor = AddO2IdVisitor::new();
                let _ = statement.visit(&mut add_o2_id_visitor);
            }
        }

        // 12. generate tantivy query
        let mut index_condition = None;
        let mut can_optimize = false;
        if stream_names.len() == 1 && cfg.common.inverted_index_enabled && use_inverted_index {
            let mut index_visitor = IndexVisitor::new(
                &used_schemas,
                cfg.common.feature_query_remove_filter_with_index,
                cfg.common.inverted_index_count_optimizer_enabled,
            );
            let _ = statement.visit(&mut index_visitor);
            index_condition = index_visitor.index_condition;
            can_optimize = index_visitor.can_optimize;
        }

        // use all condition for histogram without filter
        if use_inverted_index && can_optimize && index_condition.is_none() {
            index_condition = Some(IndexCondition {
                conditions: vec![Condition::All()],
            });
        }

        //********************Change the sql here*********************************//

        // 13. check `select * from table where match_all()` optimizer
        let mut index_optimize_mode = None;
        if !is_complex_query(&mut statement)
            && order_by.len() == 1
            && order_by[0].0 == TIMESTAMP_COL_NAME
            && can_optimize
        {
            index_optimize_mode = Some(InvertedIndexOptimizeMode::SimpleSelect(
                (offset + limit) as usize,
                order_by[0].1 == OrderBy::Asc,
            ));
        }

        // 14. check other inverted index optimize modes
        // `select count(*) from table where match_all` -> SimpleCount
        // or `select histogram(..), count(*) from table where match_all` -> SimpleHistogram
        if can_optimize && index_optimize_mode.is_none() {
            let mut visitor = OtherIndexOptimizeModeVisitor::new();
            let _ = statement.visit(&mut visitor);
            if visitor.is_simple_count {
                index_optimize_mode = Some(InvertedIndexOptimizeMode::SimpleCount);
            } else if visitor.is_simple_histogram && histogram_interval_visitor.interval.is_some() {
                let bucket_width = histogram_interval_visitor.interval.unwrap() as u64 * 1_000_000;
                // round the bucket edges to even start
                let rounding_by = bucket_width as i64;
                let min_value = (query.start_time / rounding_by) * rounding_by;
                let max_value = (query.end_time / rounding_by) * rounding_by;
                let num_buckets =
                    ((max_value - min_value) as f64 / bucket_width as f64).ceil() as usize;
                index_optimize_mode = Some(InvertedIndexOptimizeMode::SimpleHistogram(
                    min_value,
                    bucket_width,
                    num_buckets,
                ));
            }
        }

        // 15. replace the Utf8 to Utf8View type
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

fn generate_select_star_schema(
    schemas: HashMap<TableReference, Arc<SchemaCache>>,
    columns: &HashMap<TableReference, HashSet<String>>,
    has_original_column: HashMap<TableReference, bool>,
    quick_mode: bool,
    quick_mode_num_fields: usize,
    search_event_type: &Option<SearchEventType>,
    need_fst_fields: bool,
) -> HashMap<TableReference, Arc<SchemaCache>> {
    let mut used_schemas = HashMap::new();
    for (name, schema) in schemas {
        let stream_settings = unwrap_stream_settings(schema.schema());
        let defined_schema_fields = get_stream_setting_defined_schema_fields(&stream_settings);
        let has_original_column = *has_original_column.get(&name).unwrap_or(&false);
        // check if it is user defined schema
        if defined_schema_fields.is_empty() || defined_schema_fields.len() > quick_mode_num_fields {
            let quick_mode = quick_mode && schema.schema().fields().len() > quick_mode_num_fields;
            // don't automatically skip _original for scheduled pipeline searches
            let skip_original_column = !has_original_column
                && !matches!(search_event_type, Some(SearchEventType::DerivedStream))
                && (schema.contains_field(ORIGINAL_DATA_COL_NAME)
                    || schema.contains_field(ALL_VALUES_COL_NAME));
            if quick_mode || skip_original_column {
                let fields = if quick_mode {
                    let mut columns = columns.get(&name).cloned();
                    // filter columns by defined schema fields
                    if !defined_schema_fields.is_empty() {
                        let uds_columns = defined_schema_fields.iter().collect::<HashSet<_>>();
                        if let Some(columns) = columns.as_mut() {
                            columns.retain(|column| uds_columns.contains(column));
                        }
                    }
                    let fts_fields = get_stream_setting_fts_fields(&stream_settings);
                    generate_quick_mode_fields(
                        schema.schema(),
                        columns,
                        &fts_fields,
                        skip_original_column,
                        need_fst_fields,
                    )
                } else {
                    // skip selecting "_original" column if `SELECT * ...`
                    let mut fields = schema.schema().fields().iter().cloned().collect::<Vec<_>>();
                    if !need_fst_fields {
                        fields.retain(|field| {
                            field.name() != ORIGINAL_DATA_COL_NAME
                                && field.name() != ALL_VALUES_COL_NAME
                        });
                    }
                    fields
                };
                let schema = Arc::new(SchemaCache::new(
                    Schema::new(fields).with_metadata(schema.schema().metadata().clone()),
                ));
                used_schemas.insert(name, schema);
            } else {
                used_schemas.insert(name, schema);
            }
        } else {
            used_schemas.insert(
                name,
                generate_user_defined_schema(schema.as_ref(), defined_schema_fields),
            );
        }
    }
    used_schemas
}

fn generate_user_defined_schema(
    schema: &SchemaCache,
    defined_schema_fields: Vec<String>,
) -> Arc<SchemaCache> {
    let cfg = get_config();
    let mut fields: HashSet<String> = defined_schema_fields.iter().cloned().collect();
    if !fields.contains(TIMESTAMP_COL_NAME) {
        fields.insert(TIMESTAMP_COL_NAME.to_string());
    }
    if !cfg.common.feature_query_exclude_all && !fields.contains(&cfg.common.column_all) {
        fields.insert(cfg.common.column_all.to_string());
    }
    if !fields.contains(ID_COL_NAME) {
        fields.insert(ID_COL_NAME.to_string());
    }
    let new_fields = fields
        .iter()
        .filter_map(|name| schema.field_with_name(name).cloned())
        .collect::<Vec<_>>();

    Arc::new(SchemaCache::new(
        Schema::new(new_fields).with_metadata(schema.schema().metadata().clone()),
    ))
}

fn generate_quick_mode_fields(
    schema: &Schema,
    columns: Option<HashSet<String>>,
    fts_fields: &[String],
    skip_original_column: bool,
    need_fst_fields: bool,
) -> Vec<Arc<arrow_schema::Field>> {
    let cfg = get_config();
    let strategy = cfg.limit.quick_mode_strategy.to_lowercase();
    let schema_fields = schema.fields().iter().cloned().collect::<Vec<_>>();
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
                .cloned()
                .collect::<Vec<_>>();
            if schema_fields.len() > inner_fields.len() {
                let skip = std::cmp::max(0, schema_fields.len() + inner_fields.len() - need_num);
                inner_fields.extend(schema_fields.into_iter().skip(skip));
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

    let mut fields_name = fields
        .iter()
        .map(|f| f.name().to_string())
        .collect::<HashSet<_>>();

    // check _all column
    if cfg.common.feature_query_exclude_all {
        if fields_name.contains(&cfg.common.column_all) {
            fields.retain(|field| field.name().ne(&cfg.common.column_all));
        }
        if fields_name.contains(ORIGINAL_DATA_COL_NAME) {
            fields.retain(|field| field.name().ne(ORIGINAL_DATA_COL_NAME));
        }
        if fields_name.contains(ALL_VALUES_COL_NAME) {
            fields.retain(|field| field.name().ne(ALL_VALUES_COL_NAME));
        }
    }

    // check _timestamp column
    if !fields_name.contains(TIMESTAMP_COL_NAME)
        && let Ok(field) = schema.field_with_name(TIMESTAMP_COL_NAME)
    {
        fields.push(Arc::new(field.clone()));
        fields_name.insert(TIMESTAMP_COL_NAME.to_string());
    }
    // add the selected columns
    if let Some(columns) = columns {
        for column in columns {
            if !fields_name.contains(&column)
                && let Ok(field) = schema.field_with_name(&column)
            {
                fields.push(Arc::new(field.clone()));
                fields_name.insert(column.to_string());
            }
        }
    }
    // check fts fields
    if need_fst_fields {
        for field in fts_fields {
            if !fields_name.contains(field)
                && let Ok(field) = schema.field_with_name(field)
            {
                fields.push(Arc::new(field.clone()));
                fields_name.insert(field.to_string());
            }
        }
    } else if fields_name.contains(ALL_VALUES_COL_NAME) {
        fields.retain(|field| field.name() != ALL_VALUES_COL_NAME);
    }

    // check quick mode fields
    for field in config::QUICK_MODEL_FIELDS.iter() {
        if !fields_name.contains(field)
            && let Ok(field) = schema.field_with_name(field)
        {
            fields.push(Arc::new(field.clone()));
            fields_name.insert(field.to_string());
        }
    }
    if !need_fst_fields && skip_original_column && fields_name.contains(ORIGINAL_DATA_COL_NAME) {
        fields.retain(|field| field.name() != ORIGINAL_DATA_COL_NAME);
    }
    fields
}

// add field from full text search
fn generate_schema_fields(
    columns: HashSet<String>,
    schema: &SchemaCache,
    has_match_all: bool,
) -> Vec<FieldRef> {
    let mut columns = columns;

    // 1. add timestamp field
    if !columns.contains(TIMESTAMP_COL_NAME) {
        columns.insert(TIMESTAMP_COL_NAME.to_string());
    }

    // 2. check _o2_id
    if !columns.contains(ID_COL_NAME) {
        columns.insert(ID_COL_NAME.to_string());
    }

    // 3. add field from full text search
    if has_match_all {
        let stream_settings = infra::schema::unwrap_stream_settings(schema.schema());
        let fts_fields = get_stream_setting_fts_fields(&stream_settings);
        for fts_field in fts_fields {
            if schema.field_with_name(&fts_field).is_none() {
                continue;
            }
            columns.insert(fts_field);
        }
    }

    // 4. generate fields
    let mut fields = Vec::with_capacity(columns.len());
    for column in columns {
        if let Some(field) = schema.field_with_name(&column) {
            fields.push(field.clone());
        }
    }
    fields
}

// check if has original column in sql
fn has_original_column(
    columns: &HashMap<TableReference, HashSet<String>>,
) -> HashMap<TableReference, bool> {
    let mut has_original_column = HashMap::with_capacity(columns.len());
    for (name, column) in columns.iter() {
        if column.contains(ORIGINAL_DATA_COL_NAME) {
            has_original_column.insert(name.clone(), true);
        } else {
            has_original_column.insert(name.clone(), false);
        }
    }
    has_original_column
}

/// visit a sql to get all columns
struct ColumnVisitor<'a> {
    columns: HashMap<TableReference, HashSet<String>>,
    columns_alias: HashSet<(String, String)>,
    schemas: &'a HashMap<TableReference, Arc<SchemaCache>>,
    group_by: Vec<String>,
    order_by: Vec<(String, OrderBy)>, // field_name, order_by
    offset: Option<i64>,
    limit: Option<i64>,
    is_wildcard: bool,
    is_distinct: bool,
    has_agg_function: bool,
    use_inverted_index: bool,
}

impl<'a> ColumnVisitor<'a> {
    fn new(schemas: &'a HashMap<TableReference, Arc<SchemaCache>>) -> Self {
        Self {
            columns: HashMap::new(),
            columns_alias: HashSet::new(),
            schemas,
            group_by: Vec::new(),
            order_by: Vec::new(),
            offset: None,
            limit: None,
            is_wildcard: false,
            is_distinct: false,
            has_agg_function: false,
            use_inverted_index: false,
        }
    }
}

impl VisitorMut for ColumnVisitor<'_> {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        match expr {
            Expr::Identifier(ident) => {
                let field_name = ident.value.clone();
                for (name, schema) in self.schemas.iter() {
                    if schema.contains_field(&field_name) {
                        self.columns
                            .entry(name.clone())
                            .or_default()
                            .insert(field_name.clone());
                    }
                }
            }
            Expr::CompoundIdentifier(idents) => {
                let name = idents
                    .iter()
                    .map(|ident| ident.value.clone())
                    .collect::<Vec<_>>();
                let field_name = name.last().unwrap().clone();
                // check if table_name is in schemas, otherwise the table_name maybe is a alias
                for (name, schema) in self.schemas.iter() {
                    if schema.contains_field(&field_name) {
                        self.columns
                            .entry(name.clone())
                            .or_default()
                            .insert(field_name.clone());
                    }
                }
            }
            Expr::Function(f) => {
                if AGGREGATE_UDF_LIST
                    .contains(&trim_quotes(&f.name.to_string().to_lowercase()).as_str())
                {
                    self.has_agg_function = true;
                }
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let Some(order_by) = query.order_by.as_mut()
            && let OrderByKind::Expressions(exprs) = &mut order_by.kind
        {
            for order in exprs.iter_mut() {
                let mut name_visitor = FieldNameVisitor::new();
                let _ = order.expr.visit(&mut name_visitor);
                if name_visitor.field_names.len() == 1 {
                    let expr_name = name_visitor.field_names.iter().next().unwrap().to_string();
                    self.order_by.push((
                        expr_name,
                        if order.options.asc.unwrap_or(true) {
                            OrderBy::Asc
                        } else {
                            OrderBy::Desc
                        },
                    ));
                }
            }
        }
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_mut() {
            for select_item in select.projection.iter_mut() {
                match select_item {
                    SelectItem::ExprWithAlias { expr, alias } => {
                        self.columns_alias
                            .insert((expr.to_string(), alias.value.to_string()));
                    }
                    SelectItem::Wildcard(_) => {
                        self.is_wildcard = true;
                    }
                    _ => {}
                }
            }
            if let GroupByExpr::Expressions(exprs, _) = &mut select.group_by {
                for expr in exprs.iter_mut() {
                    let mut name_visitor = FieldNameVisitor::new();
                    let _ = expr.visit(&mut name_visitor);
                    if name_visitor.field_names.len() == 1 {
                        let expr_name = name_visitor.field_names.iter().next().unwrap().to_string();
                        self.group_by.push(expr_name);
                    }
                }
            }
            if select.distinct.is_some() {
                self.is_distinct = true;
            }
            if let Some(expr) = select.selection.as_ref() {
                // TODO: match_all only support single stream
                if self.schemas.len() == 1 {
                    for (_, schema) in self.schemas.iter() {
                        let stream_settings = unwrap_stream_settings(schema.schema());
                        let fts_fields = get_stream_setting_fts_fields(&stream_settings);
                        let index_fields = get_stream_setting_index_fields(&stream_settings);
                        let index_fields = itertools::chain(fts_fields.iter(), index_fields.iter())
                            .collect::<HashSet<_>>();
                        self.use_inverted_index =
                            checking_inverted_index_inner(&index_fields, expr);
                    }
                }
            } else if is_simple_count_query(select) || is_simple_histogram_query(select) {
                // if there is no selection, but have histogram and fst_fields, also can use
                // inverted index
                if self.schemas.len() == 1 {
                    for (_, schema) in self.schemas.iter() {
                        let stream_settings = unwrap_stream_settings(schema.schema());
                        let fts_fields = get_stream_setting_fts_fields(&stream_settings);
                        let index_fields = get_stream_setting_index_fields(&stream_settings);
                        let index_fields = itertools::chain(fts_fields.iter(), index_fields.iter())
                            .collect::<HashSet<_>>();
                        if !index_fields.is_empty() {
                            self.use_inverted_index = true;
                        }
                    }
                }
            }
        }
        if let Some(limit) = query.limit.as_ref()
            && let Expr::Value(ValueWithSpan { value, span: _ }) = limit
            && let Value::Number(n, _) = value
            && let Ok(num) = n.to_string().parse::<i64>()
        {
            self.limit = Some(num);
        }
        if let Some(offset) = query.offset.as_ref()
            && let Expr::Value(ValueWithSpan { value, span: _ }) = &offset.value
            && let Value::Number(n, _) = value
            && let Ok(num) = n.to_string().parse::<i64>()
        {
            self.offset = Some(num);
        }
        ControlFlow::Continue(())
    }
}

// generate tantivy from sql and remove filter when we can
struct IndexVisitor {
    index_fields: HashSet<String>,
    is_remove_filter: bool,
    count_optimizer_enabled: bool,
    index_condition: Option<IndexCondition>,
    pub can_optimize: bool,
}

impl IndexVisitor {
    fn new(
        schemas: &HashMap<TableReference, Arc<SchemaCache>>,
        is_remove_filter: bool,
        count_optimizer_enabled: bool,
    ) -> Self {
        let index_fields = if let Some((_, schema)) = schemas.iter().next() {
            let stream_settings = unwrap_stream_settings(schema.schema());
            let index_fields = get_stream_setting_index_fields(&stream_settings);
            index_fields.into_iter().collect::<HashSet<_>>()
        } else {
            HashSet::new()
        };
        Self {
            index_fields,
            is_remove_filter,
            count_optimizer_enabled,
            index_condition: None,
            can_optimize: false,
        }
    }

    #[allow(dead_code)]
    fn new_from_index_fields(
        index_fields: HashSet<String>,
        is_remove_filter: bool,
        count_optimizer_enabled: bool,
    ) -> Self {
        Self {
            index_fields,
            is_remove_filter,
            count_optimizer_enabled,
            index_condition: None,
            can_optimize: false,
        }
    }
}

impl VisitorMut for IndexVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_mut() {
            if let Some(expr) = select.selection.as_mut() {
                let (index, other_expr) = get_index_condition_from_expr(&self.index_fields, expr);
                self.index_condition = index;
                let can_remove_filter = self
                    .index_condition
                    .as_ref()
                    .map(|v| v.can_remove_filter())
                    .unwrap_or(true);
                // make sure all filter in where clause can be used in inverted index
                if other_expr.is_none()
                    && select.selection.is_some()
                    && (self.count_optimizer_enabled || can_remove_filter)
                {
                    self.can_optimize = true;
                }
                if self.is_remove_filter || can_remove_filter {
                    select.selection = other_expr;
                }
            } else if is_simple_count_query(select) || is_simple_histogram_query(select) {
                // if there is no selection, but have histogram, also can use inverted index
                self.can_optimize = true;
            }
        }
        ControlFlow::Continue(())
    }
}

/// get all equal items from where clause
struct PartitionColumnVisitor<'a> {
    equal_items: HashMap<TableReference, Vec<(String, String)>>, // filed = value
    schemas: &'a HashMap<TableReference, Arc<SchemaCache>>,
}

impl<'a> PartitionColumnVisitor<'a> {
    fn new(schemas: &'a HashMap<TableReference, Arc<SchemaCache>>) -> Self {
        Self {
            equal_items: HashMap::new(),
            schemas,
        }
    }
}

impl VisitorMut for PartitionColumnVisitor<'_> {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_ref()
            && let Some(expr) = select.selection.as_ref()
        {
            let exprs = split_conjunction(expr);
            for e in exprs {
                match e {
                    Expr::BinaryOp {
                        left,
                        op: BinaryOperator::Eq,
                        right,
                    } => {
                        let (left, right) = if is_value(left) && is_field(right) {
                            (right, left)
                        } else if is_value(right) && is_field(left) {
                            (left, right)
                        } else {
                            continue;
                        };
                        match left.as_ref() {
                            Expr::Identifier(ident) => {
                                let mut count = 0;
                                let field_name = ident.value.clone();
                                let mut table_name = "".to_string();
                                for (name, schema) in self.schemas.iter() {
                                    if schema.contains_field(&field_name) {
                                        count += 1;
                                        table_name = name.to_string();
                                    }
                                }
                                if count == 1 {
                                    self.equal_items
                                        .entry(TableReference::from(table_name))
                                        .or_default()
                                        .push((
                                            field_name,
                                            trim_quotes(right.to_string().as_str()),
                                        ));
                                }
                            }
                            Expr::CompoundIdentifier(idents) => {
                                let (table_name, field_name) = generate_table_reference(idents);
                                // check if table_name is in schemas, otherwise the table_name
                                // maybe is a alias
                                if self.schemas.contains_key(&table_name) {
                                    self.equal_items.entry(table_name).or_default().push((
                                        field_name,
                                        trim_quotes(right.to_string().as_str()),
                                    ));
                                }
                            }
                            _ => {}
                        }
                    }
                    Expr::InList {
                        expr,
                        list,
                        negated: false,
                    } => {
                        match expr.as_ref() {
                            Expr::Identifier(ident) => {
                                let mut count = 0;
                                let field_name = ident.value.clone();
                                let mut table_name = "".to_string();
                                for (name, schema) in self.schemas.iter() {
                                    if schema.contains_field(&field_name) {
                                        count += 1;
                                        table_name = name.to_string();
                                    }
                                }
                                if count == 1 {
                                    let entry = self
                                        .equal_items
                                        .entry(TableReference::from(table_name))
                                        .or_default();
                                    for val in list.iter() {
                                        entry.push((
                                            field_name.clone(),
                                            trim_quotes(val.to_string().as_str()),
                                        ));
                                    }
                                }
                            }
                            Expr::CompoundIdentifier(idents) => {
                                let (table_name, field_name) = generate_table_reference(idents);
                                // check if table_name is in schemas, otherwise the table_name
                                // maybe is a alias
                                if self.schemas.contains_key(&table_name) {
                                    let entry = self.equal_items.entry(table_name).or_default();
                                    for val in list.iter() {
                                        entry.push((
                                            field_name.clone(),
                                            trim_quotes(val.to_string().as_str()),
                                        ));
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                    _ => {}
                }
            }
        }
        ControlFlow::Continue(())
    }
}

/// get all equal items from where clause
struct PrefixColumnVisitor<'a> {
    prefix_items: HashMap<TableReference, Vec<(String, String)>>, // filed like 'value%'
    schemas: &'a HashMap<TableReference, Arc<SchemaCache>>,
}

impl<'a> PrefixColumnVisitor<'a> {
    fn new(schemas: &'a HashMap<TableReference, Arc<SchemaCache>>) -> Self {
        Self {
            prefix_items: HashMap::new(),
            schemas,
        }
    }
}

impl VisitorMut for PrefixColumnVisitor<'_> {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_ref()
            && let Some(expr) = select.selection.as_ref()
        {
            let exprs = split_conjunction(expr);
            for e in exprs {
                if let Expr::Like {
                    negated: false,
                    expr,
                    pattern,
                    escape_char: _,
                    any: _,
                } = e
                {
                    match expr.as_ref() {
                        Expr::Identifier(ident) => {
                            let mut count = 0;
                            let field_name = ident.value.clone();
                            let mut table_name = "".to_string();
                            for (name, schema) in self.schemas.iter() {
                                if schema.contains_field(&field_name) {
                                    count += 1;
                                    table_name = name.to_string();
                                }
                            }
                            if count == 1 {
                                let pattern = trim_quotes(pattern.to_string().as_str());
                                if !pattern.starts_with('%') && pattern.ends_with('%') {
                                    self.prefix_items
                                        .entry(TableReference::from(table_name))
                                        .or_default()
                                        .push((
                                            field_name,
                                            pattern.trim_end_matches('%').to_string(),
                                        ));
                                }
                            }
                        }
                        Expr::CompoundIdentifier(idents) => {
                            let (table_name, field_name) = generate_table_reference(idents);
                            // check if table_name is in schemas, otherwise the table_name
                            // maybe is a alias
                            if self.schemas.contains_key(&table_name) {
                                let pattern = trim_quotes(pattern.to_string().as_str());
                                if !pattern.starts_with('%') && pattern.ends_with('%') {
                                    self.prefix_items.entry(table_name).or_default().push((
                                        field_name,
                                        pattern.trim_end_matches('%').to_string(),
                                    ));
                                }
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        ControlFlow::Continue(())
    }
}

/// get all item from match_all functions
struct MatchVisitor {
    pub match_items: Option<Vec<String>>, // filed = value
}

impl MatchVisitor {
    fn new() -> Self {
        Self { match_items: None }
    }
}

impl VisitorMut for MatchVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if let Expr::Function(func) = expr {
            let name = func.name.to_string().to_lowercase();
            if (name == MATCH_ALL_UDF_NAME || name == FUZZY_MATCH_ALL_UDF_NAME)
                && let FunctionArguments::List(list) = &func.args
                && !list.args.is_empty()
            {
                let value = trim_quotes(list.args[0].to_string().as_str());
                match &mut self.match_items {
                    Some(items) => items.push(value),
                    None => self.match_items = Some(vec![value]),
                }
            }
        }
        ControlFlow::Continue(())
    }
}

struct FieldNameVisitor {
    pub field_names: HashSet<String>,
}

impl FieldNameVisitor {
    fn new() -> Self {
        Self {
            field_names: HashSet::new(),
        }
    }
}

impl VisitorMut for FieldNameVisitor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if let Expr::Identifier(ident) = expr {
            self.field_names.insert(ident.value.clone());
        }
        ControlFlow::Continue(())
    }
}

// add _timestamp to the query like `SELECT name FROM t` -> `SELECT _timestamp, name FROM t`
struct AddTimestampVisitor {}

impl AddTimestampVisitor {
    fn new() -> Self {
        Self {}
    }
}

impl VisitorMut for AddTimestampVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let SetExpr::Select(select) = query.body.as_mut() {
            let mut has_timestamp = false;
            for item in select.projection.iter_mut() {
                match item {
                    SelectItem::UnnamedExpr(expr) => {
                        let mut visitor = FieldNameVisitor::new();
                        let _ = expr.visit(&mut visitor);
                        if visitor.field_names.contains(TIMESTAMP_COL_NAME) {
                            has_timestamp = true;
                            break;
                        }
                    }
                    SelectItem::ExprWithAlias { expr, alias: _ } => {
                        let mut visitor = FieldNameVisitor::new();
                        let _ = expr.visit(&mut visitor);
                        if visitor.field_names.contains(TIMESTAMP_COL_NAME) {
                            has_timestamp = true;
                            break;
                        }
                    }
                    SelectItem::Wildcard(_) => {
                        has_timestamp = true;
                        break;
                    }
                    _ => {}
                }
            }
            if !has_timestamp {
                select.projection.insert(
                    0,
                    SelectItem::UnnamedExpr(Expr::Identifier(Ident::new(
                        TIMESTAMP_COL_NAME.to_string(),
                    ))),
                );
            }
        }
        ControlFlow::Continue(())
    }
}

// add _o2_id to the query like `SELECT name FROM t` -> `SELECT _o2_id, name FROM t`
struct AddO2IdVisitor {}

impl AddO2IdVisitor {
    fn new() -> Self {
        Self {}
    }
}

impl VisitorMut for AddO2IdVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let SetExpr::Select(select) = query.body.as_mut() {
            let mut has_o2_id = false;
            for item in select.projection.iter_mut() {
                match item {
                    SelectItem::UnnamedExpr(expr) => {
                        let mut visitor = FieldNameVisitor::new();
                        let _ = expr.visit(&mut visitor);
                        if visitor.field_names.contains(ID_COL_NAME) {
                            has_o2_id = true;
                            break;
                        }
                    }
                    SelectItem::ExprWithAlias { expr, alias: _ } => {
                        let mut visitor = FieldNameVisitor::new();
                        let _ = expr.visit(&mut visitor);
                        if visitor.field_names.contains(ID_COL_NAME) {
                            has_o2_id = true;
                            break;
                        }
                    }
                    SelectItem::Wildcard(_) => {
                        has_o2_id = true;
                        break;
                    }
                    _ => {}
                }
            }
            if !has_o2_id {
                select.projection.insert(
                    0,
                    SelectItem::UnnamedExpr(Expr::Identifier(Ident::new(ID_COL_NAME.to_string()))),
                );
            }
        }
        ControlFlow::Continue(())
    }
}

// check if the query is simple count query
// 1. doesn't have subquery
// 2. doesn't have join
// 3. doesn't have group by
// 4. doesn't have SetOperation(UNION/EXCEPT/INTERSECT of two queries)
// 5. doesn't have distinct
//
// either only has count(*) -> SimpleCount
// or has histogram(...) and count(*) -> SimpleHistogram
struct OtherIndexOptimizeModeVisitor {
    pub is_simple_count: bool,
    pub is_simple_histogram: bool,
}

impl OtherIndexOptimizeModeVisitor {
    fn new() -> Self {
        Self {
            is_simple_count: false,
            is_simple_histogram: false,
        }
    }
}

impl VisitorMut for OtherIndexOptimizeModeVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_ref() {
            if select.projection.len() > 2
                || select.distinct.is_some()
                || select.from.len() > 1
                || select.from.iter().any(|from| {
                    !from.joins.is_empty()
                        || matches!(
                            from.relation,
                            TableFactor::Derived { .. } | TableFactor::Function { .. }
                        )
                })
            {
                return ControlFlow::Break(());
            }

            if select.projection.len() == 1
                && matches!(select.group_by, GroupByExpr::Expressions(ref expr, _) if expr.is_empty())
            {
                self.is_simple_count = is_simple_count_query(select);
            } else if is_simple_histogram_query(select) {
                self.is_simple_histogram = true;
            }
        }
        if self.is_simple_count || self.is_simple_histogram {
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if matches!(
            expr,
            Expr::Subquery(_) | Expr::Exists { .. } | Expr::InSubquery { .. }
        ) {
            self.is_simple_count = false;
            self.is_simple_histogram = false;
            return ControlFlow::Break(());
        }
        ControlFlow::Continue(())
    }
}

fn is_complex_query(statement: &mut Statement) -> bool {
    let mut visitor = ComplexQueryVisitor::new();
    let _ = statement.visit(&mut visitor);
    visitor.is_complex
}

// check if the query is only count(*) query
fn is_simple_count_query(select: &Select) -> bool {
    select.projection.len() == 1 && is_sql_func(&select.projection[0], "count", true)
}

// check if the query is only histogram & count query
fn is_simple_histogram_query(select: &Select) -> bool {
    select.projection.len() == 2
        && is_sql_func(&select.projection[0], "histogram", false)
        && is_sql_func(&select.projection[1], "count", true)
}

// Check if the query is a simple `select sql_func(*)` without modifiers
fn is_sql_func(select: &SelectItem, fn_name: &str, with_star: bool) -> bool {
    match select {
        SelectItem::UnnamedExpr(expr) | SelectItem::ExprWithAlias { expr, .. } => {
            if let Expr::Function(func) = expr {
                let name = trim_quotes(&func.name.to_string().to_lowercase());
                // Check function name matches and has no special modifiers
                let has_no_modifiers =
                    func.filter.is_none() && func.over.is_none() && func.within_group.is_empty();

                // If with_start is true, check for single "*" argument
                let has_valid_args = if with_star {
                    matches!(
                        &func.args,
                        FunctionArguments::List(list)
                            if list.args.len() == 1
                            && trim_quotes(&list.args[0].to_string()) == "*"
                    )
                } else {
                    true
                };

                name == fn_name && has_no_modifiers && has_valid_args
            } else {
                false
            }
        }
        _ => false,
    }
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
            && func.name.to_string().to_lowercase() == "histogram"
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
                    generate_histogram_interval(self.time_range)
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

fn generate_table_reference(idents: &[Ident]) -> (TableReference, String) {
    if idents.len() == 2 {
        let table_name = idents[0].value.clone();
        let field_name = idents[1].value.clone();
        (TableReference::from(table_name), field_name)
    } else {
        let stream_type = idents[0].value.clone();
        let table_name = idents[1].value.clone();
        let field_name = idents[2].value.clone();
        (TableReference::partial(stream_type, table_name), field_name)
    }
}

fn checking_inverted_index_inner(index_fields: &HashSet<&String>, expr: &Expr) -> bool {
    match expr {
        Expr::Identifier(Ident {
            value,
            quote_style: _,
            span: _,
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
        Expr::InList {
            expr,
            list: _,
            negated: _,
        } => checking_inverted_index_inner(index_fields, expr),
        Expr::Like {
            negated: _,
            expr,
            pattern: _,
            escape_char: _,
            any: _,
        } => checking_inverted_index_inner(index_fields, expr),
        Expr::Function(func) => {
            let f = func.name.to_string().to_lowercase();

            if f == MATCH_ALL_UDF_NAME || f == FUZZY_MATCH_ALL_UDF_NAME {
                return true;
            }

            if (f == STR_MATCH_UDF_NAME
                || f == STR_MATCH_UDF_IGNORE_CASE_NAME
                || f == MATCH_FIELD_UDF_NAME
                || f == MATCH_FIELD_IGNORE_CASE_UDF_NAME)
                && let FunctionArguments::List(list) = &func.args
            {
                return list.args.len() == 2 && index_fields.contains(&get_arg_name(&list.args[0]));
            }

            false
        }
        _ => false,
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

pub fn generate_histogram_interval(time_range: Option<(i64, i64)>) -> String {
    if time_range.is_none() || time_range.unwrap().eq(&(0, 0)) {
        return "1 hour".to_string();
    }
    let duration = time_range.map(|r| r.1 - r.0).unwrap();

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
            return interval.to_string();
        }
    }
    "10 second".to_string()
}

pub fn convert_histogram_interval_to_seconds(interval: &str) -> Result<i64, Error> {
    let interval = interval.trim();
    let (num, unit) = interval
        .find(|c: char| !c.is_numeric())
        .map(|pos| interval.split_at(pos))
        .ok_or_else(|| Error::Message(format!("Invalid interval format: '{interval}'")))?;

    let seconds = match unit.trim().to_lowercase().as_str() {
        "second" | "seconds" | "s" | "secs" | "sec" => num.parse::<i64>(),
        "minute" | "minutes" | "m" | "mins" | "min" => num.parse::<i64>().map(|n| n * 60),
        "hour" | "hours" | "h" | "hrs" | "hr" => num.parse::<i64>().map(|n| n * 3600),
        "day" | "days" | "d" => num.parse::<i64>().map(|n| n * 86400),
        _ => {
            return Err(Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
                "Unsupported histogram interval unit".to_string(),
            )));
        }
    };
    seconds.map_err(|_| {
        Error::ErrorCode(ErrorCodes::SearchSQLNotValid(
            "Invalid number format".to_string(),
        ))
    })
}

pub fn pickup_where(sql: &str, meta: Option<MetaSql>) -> Result<Option<String>, Error> {
    #[allow(deprecated)]
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
            if fname.value == ENCRYPT_UDF_NAME || fname.value == DECRYPT_UDF_NAME {
                let list = match args {
                    FunctionArguments::List(list) => list,
                    _ => {
                        self.error = Some(Error::Message(
                            "invalid arguments to cipher function".to_string(),
                        ));
                        return ControlFlow::Continue(());
                    }
                };
                if list.args.len() != 2 {
                    self.error = Some(Error::Message(
                        "invalid number of arguments to cipher function".to_string(),
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

    use arrow_schema::{DataType, Field};
    use sqlparser::dialect::GenericDialect;

    use super::*;

    #[test]
    fn test_index_visitor1() {
        let sql = "SELECT * FROM t WHERE name = 'a' AND age = 1 AND (name = 'b' OR (match_all('good') AND match_all('bar'))) AND (match_all('foo') OR age = 2)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut index_fields = HashSet::new();
        index_fields.insert("name".to_string());
        let mut index_visitor = IndexVisitor::new_from_index_fields(index_fields, true, true);
        let _ = statement.visit(&mut index_visitor);
        let expected = "name=a AND (name=b OR (_all:good AND _all:bar))";
        let expected_sql = "SELECT * FROM t WHERE age = 1 AND (match_all('foo') OR age = 2)";
        assert_eq!(
            index_visitor.index_condition.clone().unwrap().to_query(),
            expected
        );
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_index_visitor2() {
        let sql = "SELECT * FROM t WHERE name is not null AND age > 1 AND (match_all('foo') OR abs(age) = 2)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut index_fields = HashSet::new();
        index_fields.insert("name".to_string());
        let mut index_visitor = IndexVisitor::new_from_index_fields(index_fields, true, true);
        let _ = statement.visit(&mut index_visitor);
        let expected = "";
        let expected_sql = "SELECT * FROM t WHERE name IS NOT NULL AND age > 1 AND (match_all('foo') OR abs(age) = 2)";
        assert_eq!(
            index_visitor
                .index_condition
                .clone()
                .unwrap_or_default()
                .to_query(),
            expected
        );
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_index_visitor3() {
        let sql = "SELECT * FROM t WHERE (name = 'b' OR (match_all('good') AND match_all('bar'))) OR (match_all('foo') OR age = 2)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut index_fields = HashSet::new();
        index_fields.insert("name".to_string());
        let mut index_visitor = IndexVisitor::new_from_index_fields(index_fields, true, true);
        let _ = statement.visit(&mut index_visitor);
        let expected = "";
        let expected_sql = "SELECT * FROM t WHERE (name = 'b' OR (match_all('good') AND match_all('bar'))) OR (match_all('foo') OR age = 2)";
        assert_eq!(
            index_visitor
                .index_condition
                .clone()
                .unwrap_or_default()
                .to_query(),
            expected
        );
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_index_visitor4() {
        let sql = "SELECT * FROM t WHERE (name = 'b' OR (match_all('good') AND match_all('bar'))) OR (match_all('foo') AND name = 'c')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut index_fields = HashSet::new();
        index_fields.insert("name".to_string());
        let mut index_visitor = IndexVisitor::new_from_index_fields(index_fields, true, true);
        let _ = statement.visit(&mut index_visitor);
        let expected = "((name=b OR (_all:good AND _all:bar)) OR (_all:foo AND name=c))";
        let expected_sql = "SELECT * FROM t";
        assert_eq!(
            index_visitor.index_condition.clone().unwrap().to_query(),
            expected
        );
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_index_visitor5() {
        let sql = "SELECT * FROM t WHERE (foo = 'b' OR foo = 'c') AND foo = 'd' AND ((match_all('good') AND match_all('bar')) OR (match_all('foo') AND name = 'c'))";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut index_fields = HashSet::new();
        index_fields.insert("name".to_string());
        let mut index_visitor = IndexVisitor::new_from_index_fields(index_fields, true, true);
        let _ = statement.visit(&mut index_visitor);
        let expected = "((_all:good AND _all:bar) OR (_all:foo AND name=c))";
        let expected_sql = "SELECT * FROM t WHERE (foo = 'b' OR foo = 'c') AND foo = 'd'";
        assert_eq!(
            index_visitor.index_condition.clone().unwrap().to_query(),
            expected
        );
        assert_eq!(statement.to_string(), expected_sql);
    }

    // test index_visitor for str_match
    #[test]
    fn test_index_visitor_str_match() {
        let sql = "SELECT * FROM t WHERE str_match(name, 'value')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut index_fields = HashSet::new();
        index_fields.insert("name".to_string());
        let mut index_visitor = IndexVisitor::new_from_index_fields(index_fields, true, true);
        let _ = statement.visit(&mut index_visitor);
        let expected = "str_match(name, 'value')";
        assert_eq!(
            index_visitor.index_condition.clone().unwrap().to_query(),
            expected
        );
    }

    // test index_visitor for str_match_ignore_case
    #[test]
    fn test_index_visitor_str_match_ignore_case() {
        let sql = "SELECT * FROM t WHERE str_match_ignore_case(name, 'value')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut index_fields = HashSet::new();
        index_fields.insert("name".to_string());
        let mut index_visitor = IndexVisitor::new_from_index_fields(index_fields, true, true);
        let _ = statement.visit(&mut index_visitor);
        let expected = "str_match_ignore_case(name, 'value')";
        assert_eq!(
            index_visitor.index_condition.clone().unwrap().to_query(),
            expected
        );
    }

    #[test]
    fn test_track_total_hits1() {
        let sql = "SELECT * FROM t WHERE name = 'a'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        let expected_sql = "SELECT count(*) AS zo_sql_num FROM t WHERE name = 'a'";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits2() {
        let sql = "SELECT name, count(*) FROM t WHERE name = 'a' group by name order by name";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        let expected_sql = "SELECT count(*) AS zo_sql_num FROM t WHERE name = 'a'";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits3() {
        let sql = "SELECT t1.name, t2.name from t1 join t2 on t1.name = t2.name where t1.name = 'openobserve' group by t1.name, t2.name order by t1.name, t2.name";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        let expected_sql = "SELECT count(*) AS zo_sql_num FROM t1 JOIN t2 ON t1.name = t2.name WHERE t1.name = 'openobserve'";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits4() {
        let sql = "SELECT name from t1 where name not in (select name from t2)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        let expected_sql =
            "SELECT count(*) AS zo_sql_num FROM t1 WHERE name NOT IN (SELECT name FROM t2)";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits5() {
        let sql = "SELECT name from t1 union select name from t2";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        let expected_sql =
            "SELECT count(*) AS zo_sql_num FROM (SELECT name FROM t1 UNION SELECT name FROM t2)";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits6() {
        let sql = "(SELECT name from t1) union (select name from t2)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        let expected_sql = "SELECT count(*) AS zo_sql_num FROM ((SELECT name FROM t1) UNION (SELECT name FROM t2))";
        assert_eq!(statement.to_string(), expected_sql);
    }

    #[test]
    fn test_track_total_hits7() {
        let sql = "SELECT name from t1 union select name from t2 union select name from t3";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut track_total_hits_visitor = TrackTotalHitsVisitor::new();
        let _ = statement.visit(&mut track_total_hits_visitor);
        let expected_sql = "SELECT count(*) AS zo_sql_num FROM (SELECT name FROM t1 UNION SELECT name FROM t2 UNION SELECT name FROM t3)";
        assert_eq!(statement.to_string(), expected_sql);
    }

    fn is_simple_count_query(statement: &mut Statement) -> bool {
        let mut visitor = OtherIndexOptimizeModeVisitor::new();
        let _ = statement.visit(&mut visitor);
        visitor.is_simple_count
    }

    #[test]
    fn test_is_simple_count_visit1() {
        let sql = "SELECT count(*) from t";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_count_query(&mut statement),);
    }

    #[test]
    fn test_is_simple_count_visit2() {
        let sql = "SELECT count(*) as cnt from t";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_count_query(&mut statement));
    }

    #[test]
    fn test_is_simple_count_visit3() {
        let sql = "SELECT count(*) as cnt from t where name = 'a'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_count_query(&mut statement));
    }

    #[test]
    fn test_is_simple_count_visit4() {
        let sql = "SELECT name, count(*) as cnt from t group by name order by name";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_count_query(&mut statement));
    }

    #[test]
    fn test_is_simple_count_visit5() {
        let sql = "SELECT count(_timestamp) as cnt from t";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_count_query(&mut statement));
    }

    #[test]
    fn test_is_simple_count_visit6() {
        let sql = "SELECT count(*) as cnt from (select * from t)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_count_query(&mut statement));
    }

    fn is_simple_histogram_query(statement: &mut Statement) -> bool {
        let mut visitor = OtherIndexOptimizeModeVisitor::new();
        let _ = statement.visit(&mut visitor);
        visitor.is_simple_histogram
    }

    #[test]
    fn test_is_simple_histogram_visit1() {
        let sql = "select histogram(_timestamp, '10 second') AS zo_sql_key, count(*) AS zo_sql_num from \"default\"  GROUP BY zo_sql_key ORDER BY zo_sql_key";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_histogram_query(&mut statement));
    }

    #[test]
    fn test_is_simple_histogram_visit2() {
        // Test with additional where clause
        let sql = "select histogram(_timestamp, '1m') as h, count(*) from t where name = 'test'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(is_simple_histogram_query(&mut statement));
    }

    #[test]
    fn test_is_simple_histogram_visit3() {
        // Test with wrong order of projections (count before histogram)
        let sql = "select count(*), histogram(_timestamp, '1m') from t";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_histogram_query(&mut statement));
    }

    #[test]
    fn test_is_simple_histogram_visit4() {
        // Test with subquery - should fail
        let sql = "select histogram(_timestamp, '1m'), count(*) from (select * from t)";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_histogram_query(&mut statement));
    }

    #[test]
    fn test_is_simple_histogram_visit5() {
        // Test with additional projection - should fail
        let sql = "select histogram(_timestamp, '1m'), count(*), name from t";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_histogram_query(&mut statement));
    }

    #[test]
    fn test_is_simple_histogram_visit6() {
        // Test with join - should fail
        let sql = "select histogram(_timestamp, '1m'), count(*) from t1 join t2";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();
        assert!(!is_simple_histogram_query(&mut statement));
    }

    #[test]
    fn test_check_or_add_order_by_timestamp_no_order_asc() {
        let sql = "SELECT * FROM logs";
        let result = check_or_add_order_by_timestamp(sql, true).unwrap();
        assert_eq!(result, "SELECT * FROM logs ORDER BY _timestamp ASC");
    }

    #[test]
    fn test_check_or_add_order_by_timestamp_no_order_desc() {
        let sql = "SELECT * FROM logs";
        let result = check_or_add_order_by_timestamp(sql, false).unwrap();
        assert_eq!(result, "SELECT * FROM logs ORDER BY _timestamp DESC");
    }

    #[test]
    fn test_check_or_add_order_by_timestamp_aggregation() {
        let sql = "SELECT COUNT(*) FROM logs";
        let result = check_or_add_order_by_timestamp(sql, true).unwrap();
        assert_eq!(result, "SELECT COUNT(*) FROM logs");
    }

    #[test]
    fn test_check_or_add_order_by_timestamp_existing_order() {
        let sql = "SELECT * FROM logs ORDER BY field1 DESC";
        let result = check_or_add_order_by_timestamp(sql, true).unwrap();
        assert_eq!(sql, result);
    }

    #[test]
    fn test_check_or_add_order_by_timestamp_with_where() {
        let sql = "SELECT * FROM logs WHERE field1 = 'value'";
        let result = check_or_add_order_by_timestamp(sql, true).unwrap();
        assert_eq!(
            result,
            "SELECT * FROM logs WHERE field1 = 'value' ORDER BY _timestamp ASC"
        );
    }

    #[test]
    fn test_convert_histogram_interval_abbreviations() {
        // Test abbreviated formats
        assert_eq!(convert_histogram_interval_to_seconds("1s").unwrap(), 1);
        assert_eq!(convert_histogram_interval_to_seconds("5m").unwrap(), 300);
        assert_eq!(convert_histogram_interval_to_seconds("2h").unwrap(), 7200);
        assert_eq!(convert_histogram_interval_to_seconds("1d").unwrap(), 86400);
        assert!(convert_histogram_interval_to_seconds("1w").is_err()); // week is not supported
        assert!(convert_histogram_interval_to_seconds("1M").is_ok()); // month is not supported, but m also means minute, so it is ok
        assert!(convert_histogram_interval_to_seconds("1y").is_err()); // year is not supported
    }

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
    fn test_column_visitor() {
        let sql = "SELECT name, age, COUNT(*) FROM users WHERE status = 'active' GROUP BY name, age ORDER BY name";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut schemas = HashMap::new();
        let schema = Schema::new(vec![
            Arc::new(Field::new("name", DataType::Utf8, false)),
            Arc::new(Field::new("age", DataType::Int32, false)),
            Arc::new(Field::new("status", DataType::Utf8, false)),
        ]);
        schemas.insert(
            TableReference::from("users"),
            Arc::new(SchemaCache::new(schema)),
        );

        let mut column_visitor = ColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut column_visitor);

        // Should extract columns, group by, order by, and detect aggregate function
        assert!(column_visitor.has_agg_function);
        assert_eq!(column_visitor.group_by, vec!["name", "age"]);
        assert_eq!(
            column_visitor.order_by,
            vec![("name".to_string(), OrderBy::Asc)]
        );
    }

    #[test]
    fn test_partition_column_visitor() {
        let sql = "SELECT * FROM users WHERE name = 'john' AND age = 25 AND city IN ('NYC', 'LA')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut schemas = HashMap::new();
        let schema = Schema::new(vec![
            Arc::new(Field::new("name", DataType::Utf8, false)),
            Arc::new(Field::new("age", DataType::Int32, false)),
            Arc::new(Field::new("city", DataType::Utf8, false)),
        ]);
        schemas.insert(
            TableReference::from("users"),
            Arc::new(SchemaCache::new(schema)),
        );

        let mut partition_visitor = PartitionColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut partition_visitor);

        // Should extract equal conditions and IN list values
        let users_table = TableReference::from("users");
        assert!(partition_visitor.equal_items.contains_key(&users_table));
        let items = &partition_visitor.equal_items[&users_table];
        assert!(items.contains(&("name".to_string(), "john".to_string())));
        assert!(items.contains(&("age".to_string(), "25".to_string())));
        assert!(items.contains(&("city".to_string(), "NYC".to_string())));
        assert!(items.contains(&("city".to_string(), "LA".to_string())));
    }

    #[test]
    fn test_prefix_column_visitor() {
        let sql = "SELECT * FROM users WHERE name LIKE 'john%' AND email LIKE 'test%'";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut schemas = HashMap::new();
        let schema = Schema::new(vec![
            Arc::new(Field::new("name", DataType::Utf8, false)),
            Arc::new(Field::new("email", DataType::Utf8, false)),
        ]);
        schemas.insert(
            TableReference::from("users"),
            Arc::new(SchemaCache::new(schema)),
        );

        let mut prefix_visitor = PrefixColumnVisitor::new(&schemas);
        let _ = statement.visit(&mut prefix_visitor);

        // Should extract prefix patterns
        let users_table = TableReference::from("users");
        assert!(prefix_visitor.prefix_items.contains_key(&users_table));
        let items = &prefix_visitor.prefix_items[&users_table];
        assert!(items.contains(&("name".to_string(), "john".to_string())));
        assert!(items.contains(&("email".to_string(), "test".to_string())));
    }

    #[test]
    fn test_match_visitor() {
        let sql = "SELECT * FROM logs WHERE match_all('error') AND match_all('critical')";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut match_visitor = MatchVisitor::new();
        let _ = statement.visit(&mut match_visitor);

        // Should extract match_all values
        assert!(match_visitor.match_items.is_some());
        let items = match_visitor.match_items.unwrap();
        assert!(items.contains(&"error".to_string()));
        assert!(items.contains(&"critical".to_string()));
    }

    #[test]
    fn test_field_name_visitor() {
        let sql = "SELECT name, age FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut field_visitor = FieldNameVisitor::new();
        let _ = statement.visit(&mut field_visitor);

        // Should extract field names
        assert!(field_visitor.field_names.contains("name"));
        assert!(field_visitor.field_names.contains("age"));
    }

    #[test]
    fn test_add_timestamp_visitor() {
        let sql = "SELECT name, age FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut add_timestamp_visitor = AddTimestampVisitor::new();
        let _ = statement.visit(&mut add_timestamp_visitor);

        // Should add _timestamp to the beginning of projection
        let expected = "SELECT _timestamp, name, age FROM users";
        assert_eq!(statement.to_string(), expected);
    }

    #[test]
    fn test_add_o2_id_visitor() {
        let sql = "SELECT name, age FROM users";
        let mut statement = sqlparser::parser::Parser::parse_sql(&GenericDialect {}, sql)
            .unwrap()
            .pop()
            .unwrap();

        let mut add_o2_id_visitor = AddO2IdVisitor::new();
        let _ = statement.visit(&mut add_o2_id_visitor);

        // Should add _o2_id to the beginning of projection
        let expected = "SELECT _o2_id, name, age FROM users";
        assert_eq!(statement.to_string(), expected);
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
}
