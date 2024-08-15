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

use config::meta::{
    sql::resolve_stream_names,
    stream::{FileKey, StreamPartition, StreamType},
};
use datafusion::arrow::datatypes::Schema;
use infra::{errors::Error, schema::SchemaCache};
use proto::cluster_rpc;
use serde::Serialize;
use sqlparser::{
    ast::{BinaryOperator, Expr, FunctionArguments, Query, Visit, Visitor},
    dialect::GenericDialect,
    parser::Parser,
};

use super::match_source;
use crate::common::meta::stream::StreamParams;

#[derive(Clone, Debug, Serialize)]
pub struct NewSql {
    pub sql: String,
    pub org_id: String,
    pub stream_type: StreamType,
    pub stream_names: Vec<String>,
    pub match_items: Option<Vec<String>>, // only for single stream
    pub equal_items: HashMap<String, Vec<(String, String)>>, // table_name -> [(field_name, value)]
    pub schemas: HashMap<String, Arc<SchemaCache>>,
    pub limit: i64,
    pub offset: i64,
    pub time_range: Option<(i64, i64)>,
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

        // 2. get column name
        let statement = Parser::parse_sql(&GenericDialect {}, &sql)
            .unwrap()
            .pop()
            .unwrap();
        let mut column_visitor = ColumnVisitor::new(&total_schemas);
        statement.visit(&mut column_visitor);

        // TODO: handle select * from table, because we want only register used field to datafusion
        // 3. generate used schema
        let mut used_schemas = HashMap::with_capacity(total_schemas.len());
        for (table_name, schema) in total_schemas.iter() {
            let columns = column_visitor.columns.get(table_name).unwrap();
            let mut fields = Vec::with_capacity(columns.len());
            for column in columns {
                if let Some(field) = schema.field_with_name(column) {
                    fields.push(field.clone());
                }
            }
            let schema = Schema::new(fields).with_metadata(schema.schema().metadata().clone());
            used_schemas.insert(table_name.to_string(), Arc::new(SchemaCache::new(schema)));
        }

        // 3. get partition column value
        let mut partition_column_visitor = PartitionColumnVisitor::new(&total_schemas);
        statement.visit(&mut partition_column_visitor);

        // 4. get match_all() value
        let mut match_visitor = MatchVisitor::new();
        statement.visit(&mut match_visitor);

        Ok(NewSql {
            sql,
            org_id,
            stream_type,
            stream_names,
            match_items: match_visitor
                .match_items
                .is_empty()
                .then_some(match_visitor.match_items),
            equal_items: partition_column_visitor.equal_items,
            schemas: used_schemas,
            limit,
            offset,
            time_range: Some((query.start_time, query.end_time)),
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
    schemas: &'a HashMap<String, Arc<SchemaCache>>,
}

impl<'a> ColumnVisitor<'a> {
    fn new(schemas: &'a HashMap<String, Arc<SchemaCache>>) -> Self {
        Self {
            columns: HashMap::new(),
            schemas,
        }
    }
}

impl<'a> Visitor for ColumnVisitor<'a> {
    type Break = ();

    fn pre_visit_expr(&mut self, expr: &Expr) -> ControlFlow<Self::Break> {
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

impl<'a> Visitor for PartitionColumnVisitor<'a> {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
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
    pub match_items: Vec<String>, // filed = value
}

impl MatchVisitor {
    fn new() -> Self {
        Self {
            match_items: Vec::new(),
        }
    }
}

impl Visitor for MatchVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
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
                                self.match_items.push(value);
                            }
                        }
                    }
                }
            }
        }
        ControlFlow::Continue(())
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
