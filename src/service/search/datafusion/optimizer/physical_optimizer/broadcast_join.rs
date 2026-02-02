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

use chrono::{DateTime, Datelike, Utc};
use config::ider::uuid;
use datafusion::{
    common::{
        Result,
        tree_node::{Transformed, TreeNode, TreeNodeRewriter},
    },
    physical_plan::{ExecutionPlan, limit::GlobalLimitExec},
};
use o2_enterprise::enterprise::search::datafusion::distributed_plan::{
    broadcast_join_exec::BroadcastJoinExec, tmp_exec::TmpExec,
};

use crate::service::search::datafusion::{
    distributed_plan::node::RemoteScanNodes,
    optimizer::physical_optimizer::remote_scan::{
        RemoteScanRewriter, remote_scan_to_top_if_needed,
    },
};

pub fn broadcast_join_rewrite(
    plan: Arc<dyn ExecutionPlan>,
    remote_scan_nodes: Arc<RemoteScanNodes>,
) -> Result<Arc<dyn ExecutionPlan>> {
    let mut rewriter = BroadcastJoinRewriter::new(remote_scan_nodes);
    let plan = plan.rewrite(&mut rewriter)?.data;
    Ok(plan)
}

#[derive(Debug, Clone)]
pub struct BroadcastJoinRewriter {
    remote_scan_nodes: Arc<RemoteScanNodes>,
}

impl BroadcastJoinRewriter {
    pub fn new(remote_scan_nodes: Arc<RemoteScanNodes>) -> Self {
        Self { remote_scan_nodes }
    }
}

impl TreeNodeRewriter for BroadcastJoinRewriter {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Arc<dyn ExecutionPlan>) -> Result<Transformed<Self::Node>> {
        if node.name() == "HashJoinExec" {
            // 1. get the left table, apply limit, and rewrite it use RemoteScanRewriter
            let left_max_rows = config::get_config()
                .common
                .feature_broadcast_join_left_side_max_rows;
            let left = node.children()[0].clone();
            let left: Arc<dyn ExecutionPlan> =
                Arc::new(GlobalLimitExec::new(left, 0, Some(left_max_rows)));
            let mut rewriter = RemoteScanRewriter::new(self.remote_scan_nodes.clone());
            let left = left.rewrite(&mut rewriter)?.data;

            // 2. replace the left table to TmpExec
            let trace_id = &self.remote_scan_nodes.req.trace_id;
            let cluster_name = config::get_cluster_name();
            let result_path = generate_result_path(trace_id);
            let tmp_exec = Arc::new(TmpExec::new(
                trace_id.clone(),
                cluster_name.clone(),
                result_path.clone(),
                None, // set in BroadcastJoinExec during runtime
                left.schema(),
            ));

            // 3. add remoteScan at the top of the hash join
            let right = node.children()[1].clone();
            let hash_join = node.with_new_children(vec![tmp_exec, right])?;
            let hash_join =
                remote_scan_to_top_if_needed(hash_join, self.remote_scan_nodes.clone())?;

            // 4. replace the HashJoinExec to BroadcastJoinExec
            let broadcast_join = Arc::new(BroadcastJoinExec::new(
                trace_id.clone(),
                left,
                hash_join,
                cluster_name,
                result_path,
            ));
            return Ok(Transformed::yes(broadcast_join));
        }
        Ok(Transformed::no(node))
    }
}

fn generate_result_path(trace_id: &str) -> String {
    let datetime: DateTime<Utc> = Utc::now();

    let id = uuid();
    format!(
        "join/{}/{}/{}/{trace_id}/{id}.arrow",
        datetime.year(),
        datetime.month(),
        datetime.day(),
    )
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{
        common::Result,
        execution::{runtime_env::RuntimeEnvBuilder, session_state::SessionStateBuilder},
        prelude::{SessionConfig, SessionContext},
    };
    use o2_enterprise::enterprise::search::datafusion::optimizer::broadcast_join::should_use_broadcast_join;

    use crate::service::search::datafusion::{
        optimizer::physical_optimizer::join_reorder::JoinReorderRule,
        table_provider::empty_table::NewEmptyTable,
    };

    fn create_context() -> SessionContext {
        let schema = Arc::new(Schema::new(vec![
            Field::new("id", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("_timestamp", DataType::Int64, false),
        ]));

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_physical_optimizer_rule(Arc::new(JoinReorderRule::new()))
            .with_default_features()
            .build();
        let ctx = SessionContext::new_with_state(state);

        let provider1 = NewEmptyTable::new("t1", schema.clone()).with_partitions(12);
        let provider2 = NewEmptyTable::new("t2", schema.clone()).with_partitions(12);
        ctx.register_table("t1", Arc::new(provider1)).unwrap();
        ctx.register_table("t2", Arc::new(provider2)).unwrap();
        ctx
    }

    #[tokio::test]
    async fn test_should_use_broadcast_join_negative_cases() -> Result<()> {
        let ctx = create_context();

        // Test case 1: Simple join with aggregate and limit on left side
        let sql = "SELECT t1.id, count(*) as cnt FROM t1 GROUP BY t1.id LIMIT 10";
        let plan = ctx.state().create_logical_plan(sql).await?;
        let physical_plan = ctx.state().create_physical_plan(&plan).await?;

        // This should return false since there's no join in this query
        assert!(!should_use_broadcast_join(&physical_plan));

        Ok(())
    }

    #[tokio::test]
    async fn test_should_use_broadcast_join_with_union() -> Result<()> {
        let ctx = create_context();

        // Test case: Plan with UnionExec (should return false)
        let sql = "select * from t1 union select * from t2";
        let plan = ctx.state().create_logical_plan(sql).await?;
        let physical_plan = ctx.state().create_physical_plan(&plan).await?;

        assert!(!should_use_broadcast_join(&physical_plan));

        Ok(())
    }

    #[tokio::test]
    async fn test_should_use_broadcast_join_true1() -> Result<()> {
        let ctx = create_context();

        let sql = "select id, count(*) as cnt from t1 where _timestamp > 1 and id in (select distinct id from t2 where _timestamp > 1 order by id asc limit 10) group by id order by id limit 10";
        let plan = ctx.state().create_logical_plan(sql).await?;
        let physical_plan = ctx.state().create_physical_plan(&plan).await?;

        assert!(should_use_broadcast_join(&physical_plan));

        Ok(())
    }

    #[tokio::test]
    async fn test_should_use_broadcast_join_true2() -> Result<()> {
        let ctx = create_context();

        let sql = "select id, count(*) as cnt from t1 where id in (select distinct id from t2 limit 10) group by id order by id limit 10";
        let plan = ctx.state().create_logical_plan(sql).await?;
        let physical_plan = ctx.state().create_physical_plan(&plan).await?;

        config::meta::plan::print_plan(physical_plan.as_ref());

        assert!(should_use_broadcast_join(&physical_plan));

        Ok(())
    }
}
