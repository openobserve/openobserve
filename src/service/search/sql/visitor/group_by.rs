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

use config::datafusion::request::Request;
use datafusion::{
    common::{
        Result,
        tree_node::{TreeNode, TreeNodeRecursion, TreeNodeVisitor},
    },
    physical_expr::utils::collect_columns,
    physical_plan::{ExecutionPlan, aggregates::AggregateExec},
};
use hashbrown::HashSet;
use infra::errors::Error;

use crate::service::search::{
    cluster::flight::{SearchContextBuilder, register_table},
    sql::Sql,
};

// get group by fields from sql, if sql is not a single table query, return empty vector
pub async fn get_group_by_fields(sql: &Sql) -> Result<Vec<String>, Error> {
    if sql.schemas.len() != 1 {
        return Ok(vec![]);
    }
    let sql_arc = Arc::new(sql.clone());
    let ctx = SearchContextBuilder::new()
        .build(&Request::default(), &sql_arc)
        .await?;
    register_table(&ctx, &sql_arc).await?;
    let plan = ctx.state().create_logical_plan(&sql_arc.sql).await?;
    let physical_plan = ctx.state().create_physical_plan(&plan).await?;

    // visit group by fields
    let mut group_by_visitor = GroupByFieldVisitor::new();
    physical_plan.visit(&mut group_by_visitor)?;
    Ok(group_by_visitor.get_group_by_fields())
}

pub struct GroupByFieldVisitor {
    group_by_fields: HashSet<String>,
}

impl GroupByFieldVisitor {
    pub fn new() -> Self {
        Self {
            group_by_fields: HashSet::new(),
        }
    }

    pub fn get_group_by_fields(&self) -> Vec<String> {
        self.group_by_fields.iter().cloned().collect()
    }
}

impl<'n> TreeNodeVisitor<'n> for GroupByFieldVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        let name = node.name();
        if name == "AggregateExec" {
            let aggregate = node.as_any().downcast_ref::<AggregateExec>().unwrap();
            let group_by = aggregate.group_expr();
            let fields = group_by
                .expr()
                .iter()
                .flat_map(|(expr, _)| {
                    collect_columns(expr)
                        .into_iter()
                        .map(|field| field.name().to_string())
                })
                .collect::<HashSet<_>>();
            self.group_by_fields.extend(fields);
            Ok(TreeNodeRecursion::Stop)
        } else {
            Ok(TreeNodeRecursion::Continue)
        }
    }
}
