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

use std::ops::ControlFlow;

use sqlparser::ast::{
    DuplicateTreatment, Expr, Function, FunctionArg, FunctionArgExpr, FunctionArgumentList,
    FunctionArguments, GroupByExpr, Ident, ObjectName, ObjectNamePart, Query, Select, SelectFlavor,
    SelectItem, SetExpr, TableFactor, TableWithJoins, VisitorMut,
    helpers::attached_token::AttachedToken,
};

pub struct TrackTotalHitsVisitor {}

impl TrackTotalHitsVisitor {
    pub fn new() -> Self {
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
