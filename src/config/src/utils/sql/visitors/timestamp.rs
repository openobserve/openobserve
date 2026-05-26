// Copyright 2026 OpenObserve Inc.
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

use hashbrown::HashSet;
use sqlparser::ast::{
    Expr, FunctionArg, FunctionArgExpr, FunctionArguments, Query, SelectItem, SetExpr, Statement,
    TableFactor, Visit, Visitor,
};

use crate::TIMESTAMP_COL_NAME;

pub(crate) fn has_timestamp(stat: &Statement) -> bool {
    let mut visitor = TimestampVisitor::new();
    let _ = stat.visit(&mut visitor);
    visitor.timestamp_selected
}

pub struct TimestampVisitor {
    pub timestamp_selected: bool,
    timestamp_aliases: HashSet<String>,
}

impl TimestampVisitor {
    pub fn new() -> Self {
        Self {
            timestamp_selected: false,
            timestamp_aliases: HashSet::new(),
        }
    }

    fn is_timestamp_expr(expr: &Expr) -> bool {
        match expr {
            Expr::Identifier(ident) => ident.value == TIMESTAMP_COL_NAME,

            Expr::CompoundIdentifier(idents) => idents
                .last()
                .is_some_and(|id| id.value == TIMESTAMP_COL_NAME),

            Expr::Function(func) => {
                func.name.to_string().to_lowercase() == "histogram"
                    && match &func.args {
                        FunctionArguments::List(args) => args.args.iter().any(|arg| match arg {
                            FunctionArg::Unnamed(FunctionArgExpr::Expr(e)) => {
                                Self::is_timestamp_expr(e)
                            }
                            _ => false,
                        }),
                        _ => false,
                    }
            }

            _ => false,
        }
    }

    fn visit_table_factor(&mut self, relation: &TableFactor) -> ControlFlow<()> {
        match relation {
            TableFactor::Derived { subquery, .. } => {
                subquery.visit(self)?;
            }
            TableFactor::NestedJoin {
                table_with_joins,
                alias: _,
            } => {
                for join in &table_with_joins.joins {
                    join.relation.visit(self)?;
                }
                table_with_joins.relation.visit(self)?;
            }
            _ => {}
        }
        ControlFlow::Continue(())
    }

    fn check_projection(&mut self, projection: &[SelectItem]) -> ControlFlow<()> {
        for item in projection {
            match item {
                SelectItem::UnnamedExpr(expr) => {
                    if Self::is_timestamp_expr(expr) {
                        self.timestamp_selected = true;
                        return ControlFlow::Break(());
                    }

                    if let Expr::Identifier(ident) = expr
                        && self.timestamp_aliases.contains(&ident.value)
                    {
                        self.timestamp_selected = true;
                        return ControlFlow::Break(());
                    }
                }

                SelectItem::ExprWithAlias { expr, alias } => {
                    if alias.value == TIMESTAMP_COL_NAME {
                        self.timestamp_selected = true;
                        return ControlFlow::Break(());
                    }

                    if Self::is_timestamp_expr(expr) {
                        self.timestamp_aliases.insert(alias.value.clone());
                    }

                    if let Expr::Identifier(ident) = expr
                        && self.timestamp_aliases.contains(&ident.value)
                    {
                        self.timestamp_aliases.insert(alias.value.clone());
                    }
                }

                SelectItem::Wildcard(_) => {
                    self.timestamp_selected = true;
                    return ControlFlow::Break(());
                }
                _ => {}
            }
        }
        ControlFlow::Continue(())
    }

    fn visit_set_expr(&mut self, set_expr: &SetExpr) -> ControlFlow<()> {
        match set_expr {
            SetExpr::Select(select) => {
                for table in &select.from {
                    self.visit_table_factor(&table.relation)?;
                }
                self.check_projection(&select.projection)
            }
            SetExpr::Query(query) => query.visit(self),
            SetExpr::SetOperation { left, .. } => self.visit_set_expr(left),
            _ => ControlFlow::Continue(()),
        }
    }
}

impl Default for TimestampVisitor {
    fn default() -> Self {
        Self::new()
    }
}

impl Visitor for TimestampVisitor {
    type Break = ();

    fn pre_visit_query(&mut self, query: &Query) -> ControlFlow<Self::Break> {
        if let Some(with) = &query.with {
            for cte in &with.cte_tables {
                cte.query.visit(self)?;
            }
        }

        match query.body.as_ref() {
            SetExpr::Select(select) => {
                for table in &select.from {
                    self.visit_table_factor(&table.relation)?;
                }

                self.check_projection(&select.projection)
            }
            _ => self.visit_set_expr(query.body.as_ref()),
        }
    }
}
