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

use std::{
    collections::{HashMap, HashSet},
    ops::ControlFlow,
    sync::Arc,
};

use config::{
    get_config,
    meta::{
        sql::resolve_stream_names,
        stream::{FileKey, StreamPartition, StreamType},
    },
};
use datafusion::arrow::datatypes::Schema;
use infra::{errors::Error, schema::SchemaCache};
use proto::cluster_rpc;
use serde::Serialize;
use sqlparser::{
    ast::{
        BinaryOperator, Expr, Function, FunctionArg, FunctionArgExpr, FunctionArgumentList,
        FunctionArguments, GroupByExpr, Ident, ObjectName, Query, SelectItem, SetExpr, VisitMut,
        VisitorMut,
    },
    dialect::GenericDialect,
    parser::Parser,
};

use super::match_source;
use crate::{
    common::meta::stream::StreamParams,
    service::search::sql::{convert_histogram_interval_to_seconds, generate_histogram_interval},
};

#[derive(Clone, Debug, Serialize)]
pub struct NewSql {
    pub sql: String,
    pub org_id: String,
    pub stream_type: StreamType,
    pub stream_names: Vec<String>,
    pub match_items: Option<Vec<String>>, // match_all, only for single stream
    pub equal_items: HashMap<String, Vec<(String, String)>>, // table_name -> [(field_name, value)]
    pub columns: HashMap<String, HashSet<String>>, // table_name -> [field_name]
    pub aliases: Vec<(String, String)>,   // field_name, alias
    pub schemas: HashMap<String, Arc<SchemaCache>>,
    pub limit: i64,
    pub offset: i64,
    pub time_range: Option<(i64, i64)>,
    pub group_by: Vec<String>,
    pub order_by: Vec<(String, bool)>,
    pub histogram_interval: Option<i64>,
}

impl NewSql {
    pub async fn new(req: &cluster_rpc::SearchRequest) -> Result<NewSql, Error> {
        let query = req.query.as_ref().unwrap();
        let sql = query.sql.clone();
        // TODO: distribute plan to multiple nodes, remoteScan in the top
        let limit = query.size as i64;
        let offset = query.from as i64;
        let org_id = req.org_id.clone();
        let stream_type = StreamType::from(req.stream_type.as_str());

        // TODO: should check if two tables have same names
        // 1. get table name
        let stream_names = resolve_stream_names(&sql).unwrap();
        let mut total_schemas = HashMap::with_capacity(stream_names.len());
        for stream_name in stream_names.iter() {
            let schema = infra::schema::get(&org_id, stream_name, stream_type)
                .await
                .unwrap_or_else(|_| Schema::empty());
            total_schemas.insert(stream_name.clone(), Arc::new(SchemaCache::new(schema)));
        }

        let mut statement = Parser::parse_sql(&GenericDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();

        // 2. rewrite track_total_hits
        if query.track_total_hits {
            let mut trace_total_hits_visitor = TrackTotalHitsVisitor::new();
            statement.visit(&mut trace_total_hits_visitor);
        }

        // 3. get column name, alias, group by, order by
        let mut column_visitor = ColumnVisitor::new(&total_schemas);
        statement.visit(&mut column_visitor);

        let columns = column_visitor.columns.clone();
        let aliases = column_visitor
            .columns_alias
            .iter()
            .cloned()
            .collect::<Vec<_>>();
        let group_by = column_visitor.group_by;
        let order_by = column_visitor.order_by;

        // TODO: handle select * from table, because we want only register used field to datafusion
        // 4. generate used schema
        let mut used_schemas = HashMap::with_capacity(total_schemas.len());
        if column_visitor.is_wildcard {
            used_schemas = total_schemas;
        } else {
            for (table_name, schema) in total_schemas.iter() {
                let mut columns = match column_visitor.columns.get(table_name) {
                    Some(columns) => columns.clone(),
                    None => {
                        used_schemas.insert(table_name.to_string(), schema.clone());
                        continue;
                    }
                };
                if !columns.contains(&get_config().common.column_timestamp) {
                    columns.insert(get_config().common.column_timestamp.clone());
                }
                let mut fields = Vec::with_capacity(columns.len());
                for column in columns {
                    if let Some(field) = schema.field_with_name(&column) {
                        fields.push(field.clone());
                    }
                }
                let schema = Schema::new(fields).with_metadata(schema.schema().metadata().clone());
                used_schemas.insert(table_name.to_string(), Arc::new(SchemaCache::new(schema)));
            }
        }
        // 5. get partition column value
        let mut partition_column_visitor = PartitionColumnVisitor::new(&used_schemas);
        statement.visit(&mut partition_column_visitor);

        // 6. get match_all() value
        let mut match_visitor = MatchVisitor::new();
        statement.visit(&mut match_visitor);

        // 7. pick up histogram interval
        let mut histogram_interval_visitor =
            HistogramIntervalVistor::new(Some((query.start_time, query.end_time)));
        statement.visit(&mut histogram_interval_visitor);

        Ok(NewSql {
            sql: statement.to_string(),
            org_id,
            stream_type,
            stream_names,
            match_items: match_visitor.match_items,
            equal_items: partition_column_visitor.equal_items,
            columns,
            aliases,
            schemas: used_schemas,
            limit,
            offset,
            time_range: Some((query.start_time, query.end_time)),
            group_by,
            order_by,
            histogram_interval: histogram_interval_visitor.interval,
        })
    }

    /// match a source is a valid file or not
    pub async fn match_source(
        &self,
        stream_name: &str,
        source: &FileKey,
        match_min_ts_only: bool,
        is_wal: bool,
        stream_type: StreamType,
        partition_keys: &[StreamPartition],
    ) -> bool {
        let empty_fliters: Vec<(String, String)> = Vec::new();
        let mut filters: Vec<(&str, Vec<String>)> = generate_filter_from_equal_items(
            self.equal_items.get(stream_name).unwrap_or(&empty_fliters),
        );
        let partition_keys: HashMap<&str, &StreamPartition> = partition_keys
            .iter()
            .map(|v| (v.field.as_str(), v))
            .collect();
        for (key, value) in filters.iter_mut() {
            if let Some(partition_key) = partition_keys.get(key) {
                for val in value.iter_mut() {
                    *val = partition_key.get_partition_value(val);
                }
            }
        }
        match_source(
            StreamParams::new(&self.org_id, stream_name, stream_type),
            self.time_range,
            filters.as_slice(),
            source,
            is_wal,
            match_min_ts_only,
        )
        .await
    }
}

impl std::fmt::Display for NewSql {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "sql: {} \ntime_range: {:?} \norg_id: {} \nstream_type: {:?} \nstream_names: {:?} \nmatch_items: {:?} \nequal_items: {:?} \naliases: {:?} \nlimit: {} \noffset: {} \ngroup_by: {:?} \norder_by: {:?}\n",
            self.sql,
            self.time_range,
            self.org_id,
            self.stream_type,
            self.stream_names,
            self.match_items,
            self.equal_items,
            self.aliases,
            self.limit,
            self.offset,
            self.group_by,
            self.order_by
        )
    }
}

/// before [("a", "3"), ("b", "5"), ("a", "4"), ("b", "6")]
/// after [("a", ["3", "4"]), ("b", ["5", "6"])]
fn generate_filter_from_equal_items(
    equal_items: &Vec<(String, String)>,
) -> Vec<(&str, Vec<String>)> {
    let mut filters: HashMap<&str, Vec<String>> = HashMap::new();
    for (field, value) in equal_items {
        filters.entry(field).or_default().push(value.to_string());
    }
    filters.into_iter().collect()
}

/// visit a sql to get all columns
/// TODO: handle subquery without (table.field_name) perfix
struct ColumnVisitor<'a> {
    columns: HashMap<String, HashSet<String>>,
    columns_alias: HashSet<(String, String)>,
    schemas: &'a HashMap<String, Arc<SchemaCache>>,
    is_wildcard: bool,
    group_by: Vec<String>,
    order_by: Vec<(String, bool)>, // field_name, asc
}

impl<'a> ColumnVisitor<'a> {
    fn new(schemas: &'a HashMap<String, Arc<SchemaCache>>) -> Self {
        Self {
            columns: HashMap::new(),
            columns_alias: HashSet::new(),
            schemas,
            is_wildcard: false,
            group_by: Vec::new(),
            order_by: Vec::new(),
        }
    }
}

impl<'a> VisitorMut for ColumnVisitor<'a> {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        match expr {
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
                    self.columns
                        .entry(table_name)
                        .or_default()
                        .insert(field_name);
                }
            }
            Expr::CompoundIdentifier(idents) => {
                let name = idents
                    .iter()
                    .map(|ident| ident.value.clone())
                    .collect::<Vec<_>>();
                let table_name = name[0].clone();
                let filed_name = name[1].clone();
                // check if table_name is in schemas, otherwise the table_name maybe is a alias
                if self.schemas.contains_key(&table_name) {
                    self.columns
                        .entry(table_name)
                        .or_default()
                        .insert(filed_name);
                }
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let Some(order_by) = query.order_by.as_mut() {
            for order in order_by.exprs.iter_mut() {
                let mut name_visitor = FieldNameVisitor::new();
                order.expr.visit(&mut name_visitor);
                if name_visitor.field_names.len() == 1 {
                    let expr_name = name_visitor.field_names.iter().next().unwrap().to_string();
                    self.order_by.push((expr_name, order.asc.unwrap_or(true)));
                }
            }
        }
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_mut() {
            for select_item in select.projection.iter_mut() {
                match select_item {
                    SelectItem::ExprWithAlias { expr, alias } => {
                        let mut name_visitor = FieldNameVisitor::new();
                        expr.visit(&mut name_visitor);
                        if name_visitor.field_names.len() == 1 {
                            let expr_name =
                                name_visitor.field_names.iter().next().unwrap().to_string();
                            self.columns_alias
                                .insert((expr_name, alias.value.to_string()));
                        }
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
                    expr.visit(&mut name_visitor);
                    if name_visitor.field_names.len() == 1 {
                        let expr_name = name_visitor.field_names.iter().next().unwrap().to_string();
                        self.group_by.push(expr_name);
                    }
                }
            }
        }
        ControlFlow::Continue(())
    }
}

/// get all equal items from where clause
struct PartitionColumnVisitor<'a> {
    equal_items: HashMap<String, Vec<(String, String)>>, // filed = value
    schemas: &'a HashMap<String, Arc<SchemaCache>>,
}

impl<'a> PartitionColumnVisitor<'a> {
    fn new(schemas: &'a HashMap<String, Arc<SchemaCache>>) -> Self {
        Self {
            equal_items: HashMap::new(),
            schemas,
        }
    }
}

impl<'a> VisitorMut for PartitionColumnVisitor<'a> {
    type Break = ();

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_ref() {
            if let Some(expr) = select.selection.as_ref() {
                let exprs = split_conjunction(expr);
                for e in exprs {
                    if let Expr::BinaryOp {
                        left,
                        op: BinaryOperator::Eq,
                        right,
                    } = e
                    {
                        let (left, right) = if matches!(left.as_ref(), Expr::Value(_))
                            && matches!(
                                right.as_ref(),
                                Expr::Identifier(_) | Expr::CompoundIdentifier(_)
                            ) {
                            (right, left)
                        } else if matches!(right.as_ref(), Expr::Value(_))
                            && matches!(
                                left.as_ref(),
                                Expr::Identifier(_) | Expr::CompoundIdentifier(_)
                            )
                        {
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
                                    self.equal_items.entry(table_name).or_default().push((
                                        field_name,
                                        trim_quotes(right.to_string().as_str()),
                                    ));
                                }
                            }
                            Expr::CompoundIdentifier(idents) => {
                                let name = idents
                                    .iter()
                                    .map(|ident| ident.value.clone())
                                    .collect::<Vec<_>>();
                                let table_name = name[0].clone();
                                let filed_name = name[1].clone();
                                // check if table_name is in schemas, otherwise the table_name
                                // maybe is a alias
                                if self.schemas.contains_key(&table_name) {
                                    self.equal_items.entry(table_name).or_default().push((
                                        filed_name,
                                        trim_quotes(right.to_string().as_str()),
                                    ));
                                }
                            }
                            _ => {}
                        }
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

    fn pre_visit_query(&mut self, query: &mut Query) -> ControlFlow<Self::Break> {
        if let sqlparser::ast::SetExpr::Select(select) = query.body.as_ref() {
            if let Some(expr) = select.selection.as_ref() {
                let exprs = split_conjunction(expr);
                for e in exprs {
                    if let Expr::Function(func) = e {
                        let name = func.name.to_string().to_lowercase();
                        if name == "match_all"
                            || name == "match_all_raw"
                            || name == "match_all_raw_ignore_case"
                        {
                            if let FunctionArguments::List(list) = &func.args {
                                let value = trim_quotes(list.args[0].to_string().as_str());
                                match &mut self.match_items {
                                    Some(items) => items.push(value),
                                    None => self.match_items = Some(vec![value]),
                                }
                            }
                        }
                    }
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

struct HistogramIntervalVistor {
    pub interval: Option<i64>,
    time_range: Option<(i64, i64)>,
}

impl HistogramIntervalVistor {
    fn new(time_range: Option<(i64, i64)>) -> Self {
        Self {
            interval: None,
            time_range,
        }
    }
}

impl VisitorMut for HistogramIntervalVistor {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &mut Expr) -> ControlFlow<Self::Break> {
        if let Expr::Function(func) = expr {
            if func.name.to_string().to_lowercase() == "histogram" {
                if let FunctionArguments::List(list) = &func.args {
                    let mut args = list.args.iter();
                    // first is field
                    let _ = args.next();
                    // second is interval
                    let interval = if let Some(interval) = args.next() {
                        let interval = interval
                            .to_string()
                            .trim_matches(|v| v == '\'' || v == '"')
                            .to_string();
                        match interval.parse::<u16>() {
                            Ok(v) => generate_histogram_interval(self.time_range, v),
                            Err(_) => interval,
                        }
                    } else {
                        generate_histogram_interval(self.time_range, 0)
                    };
                    self.interval =
                        Some(convert_histogram_interval_to_seconds(&interval).unwrap_or_default());
                }
            }
        }
        ControlFlow::Break(())
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
        if let SetExpr::Select(select) = query.body.as_mut() {
            select.group_by = GroupByExpr::Expressions(vec![], vec![]);
            select.having = None;
            select.projection = vec![SelectItem::ExprWithAlias {
                expr: Expr::Function(Function {
                    name: ObjectName(vec![Ident::new("count")]),
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
                }),
                alias: Ident::new("zo_sql_num"),
            }];
        }
        ControlFlow::Break(())
    }
}

fn split_conjunction(expr: &Expr) -> Vec<&Expr> {
    split_conjunction_inner(expr, Vec::new())
}

fn split_conjunction_inner<'a>(expr: &'a Expr, mut exprs: Vec<&'a Expr>) -> Vec<&'a Expr> {
    match expr {
        Expr::BinaryOp {
            left,
            op: BinaryOperator::And,
            right,
        } => {
            let exprs = split_conjunction_inner(left, exprs);
            split_conjunction_inner(right, exprs)
        }
        other => {
            exprs.push(other);
            exprs
        }
    }
}

fn trim_quotes(s: &str) -> String {
    let s = s
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .unwrap_or(s);
    s.strip_prefix('\'')
        .and_then(|s| s.strip_suffix('\''))
        .unwrap_or(s)
        .to_string()
}
