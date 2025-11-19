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

use config::meta::{inverted_index::IndexOptimizeMode, stream::FileKey};
use datafusion::{
    common::{
        Result,
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter},
    },
    physical_plan::{
        ExecutionPlan,
        aggregates::{AggregateExec, AggregateMode},
        union::UnionExec,
    },
};

use crate::service::search::{
    datafusion::plan::tantivy_optimize_exec::TantivyOptimizeExec, grpc::QueryParams,
    index::IndexCondition,
};

// rewrite the physical plan to add tantivy optimize exec
pub fn tantivy_optimize_rewrite(
    query: Arc<QueryParams>,
    file_list: Vec<FileKey>,
    index_condition: Option<IndexCondition>,
    index_optimize_mode: IndexOptimizeMode,
    mut physical_plan: Arc<dyn ExecutionPlan>,
) -> Result<Arc<dyn ExecutionPlan>> {
    let tantivy_exec = Arc::new(TantivyOptimizeExec::new(
        query,
        physical_plan.schema(),
        file_list,
        index_condition,
        index_optimize_mode,
    ));
    let mut visitor = TantivyOptimizeRewriter::new(tantivy_exec);
    physical_plan = physical_plan.rewrite(&mut visitor)?.data;
    Ok(physical_plan)
}

pub struct TantivyOptimizeRewriter {
    tantivy_exec: Arc<TantivyOptimizeExec>,
}

impl TantivyOptimizeRewriter {
    pub fn new(tantivy_exec: Arc<TantivyOptimizeExec>) -> Self {
        Self { tantivy_exec }
    }
}

impl TreeNodeRewriter for TantivyOptimizeRewriter {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Arc<dyn ExecutionPlan>) -> Result<Transformed<Self::Node>> {
        if node.name() == "AggregateExec" {
            let aggregate = node.as_any().downcast_ref::<AggregateExec>().unwrap();
            if *aggregate.mode() == AggregateMode::Partial {
                let new_node = UnionExec::try_new(vec![node, self.tantivy_exec.clone() as _])?;
                Ok(Transformed::new(new_node, true, TreeNodeRecursion::Stop))
            } else {
                unreachable!("AggregateExec should be partial mode");
            }
        } else {
            Ok(Transformed::no(node))
        }
    }
}
