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

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use config::meta::inverted_index::IndexOptimizeMode;
use datafusion::{
    common::{
        Result,
        tree_node::{Transformed, TreeNode, TreeNodeRecursion, TreeNodeRewriter, TreeNodeVisitor},
    },
    config::ConfigOptions,
    physical_optimizer::PhysicalOptimizerRule,
    physical_plan::{
        ExecutionPlan, aggregates::AggregateExec,
        sorts::sort_preserving_merge::SortPreservingMergeExec,
    },
    sql::TableReference,
};
use parking_lot::Mutex;

mod count;
mod distinct;
mod histogram;
mod select;
mod topn;
mod utils;

use crate::service::search::datafusion::{
    distributed_plan::{empty_exec::NewEmptyExec, remote_scan_exec::RemoteScanExec},
    optimizer::physical_optimizer::index_optimizer::{
        count::is_simple_count, distinct::is_simple_distinct, histogram::is_simple_histogram,
        select::is_simple_select, topn::is_simple_topn, utils::is_complex_plan,
    },
};

/// this use in query follower to generate [`IndexOptimizeMode`]
/// this is used for optimizer that do not need global information
/// NOTE: use this optimizer in follower only when all filter
/// can be extract to index condition(except _timestamp filter)
#[derive(Default, Debug)]
pub struct FollowerIndexOptimizerRule {
    time_range: (i64, i64),
    index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
}

impl FollowerIndexOptimizerRule {
    pub fn new(
        time_range: (i64, i64),
        index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
    ) -> Self {
        Self {
            time_range,
            index_optimizer_mode,
        }
    }
}

impl PhysicalOptimizerRule for FollowerIndexOptimizerRule {
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        _config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        if !config::get_config().common.inverted_index_enabled {
            return Ok(plan);
        }

        let mut rewriter =
            FollowerIndexOptimizer::new(self.time_range, self.index_optimizer_mode.clone());
        let plan = plan.rewrite(&mut rewriter)?.data;
        Ok(plan)
    }

    fn name(&self) -> &str {
        "FollowerIndexOptimizerRule"
    }

    fn schema_check(&self) -> bool {
        true
    }
}

struct FollowerIndexOptimizer {
    time_range: (i64, i64),
    index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
}

impl FollowerIndexOptimizer {
    pub fn new(
        time_range: (i64, i64),
        index_optimizer_mode: Arc<Mutex<Option<IndexOptimizeMode>>>,
    ) -> Self {
        Self {
            time_range,
            index_optimizer_mode,
        }
    }
}

impl TreeNodeRewriter for FollowerIndexOptimizer {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, plan: Self::Node) -> Result<Transformed<Self::Node>> {
        if is_complex_plan(&plan) {
            return Ok(Transformed::new(plan, false, TreeNodeRecursion::Stop));
        }

        if plan
            .as_any()
            .downcast_ref::<SortPreservingMergeExec>()
            .is_some()
        {
            // Check for SimpleSelect
            if let Some(index_optimize_mode) = is_simple_select(Arc::clone(&plan)) {
                *self.index_optimizer_mode.lock() = Some(index_optimize_mode);
                return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
            }
            return Ok(Transformed::new(plan, false, TreeNodeRecursion::Continue));
        } else if plan.as_any().downcast_ref::<AggregateExec>().is_some() {
            // Check for SimpleCount
            if let Some(index_optimize_mode) = is_simple_count(Arc::clone(&plan)) {
                *self.index_optimizer_mode.lock() = Some(index_optimize_mode);
                return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
            }
            // Check for SimpleHistogram
            if let Some(index_optimize_mode) =
                is_simple_histogram(Arc::clone(&plan), self.time_range)
            {
                *self.index_optimizer_mode.lock() = Some(index_optimize_mode);
                return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
            }
            return Ok(Transformed::new(plan, false, TreeNodeRecursion::Continue));
        }
        Ok(Transformed::no(plan))
    }
}

/// this use in query leader to generate [`IndexOptimizeMode`]
/// this is used for optimizer that need global information
/// like order and limit
#[derive(Default, Debug)]
pub struct LeaderIndexOptimizerRule {
    index_fields: HashMap<TableReference, HashSet<String>>,
}

impl LeaderIndexOptimizerRule {
    pub fn new(index_fields: HashMap<TableReference, HashSet<String>>) -> Self {
        Self { index_fields }
    }
}

impl PhysicalOptimizerRule for LeaderIndexOptimizerRule {
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        _config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        if !config::get_config().common.inverted_index_enabled {
            return Ok(plan);
        }

        let mut rewriter = LeaderIndexOptimizer::new(self.index_fields.clone());
        let plan = plan.rewrite(&mut rewriter)?.data;
        Ok(plan)
    }

    fn name(&self) -> &str {
        "LeaderIndexOptimizerRule"
    }

    fn schema_check(&self) -> bool {
        true
    }
}

struct LeaderIndexOptimizer {
    index_fields: HashMap<TableReference, HashSet<String>>,
}

impl LeaderIndexOptimizer {
    pub fn new(index_fields: HashMap<TableReference, HashSet<String>>) -> Self {
        Self { index_fields }
    }
}

impl TreeNodeRewriter for LeaderIndexOptimizer {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, plan: Self::Node) -> Result<Transformed<Self::Node>> {
        if is_complex_plan(&plan) {
            return Ok(Transformed::new(plan, false, TreeNodeRecursion::Stop));
        }

        if plan
            .as_any()
            .downcast_ref::<SortPreservingMergeExec>()
            .is_some()
        {
            // Get the index fields of the underlying table
            let mut visitor = TableNameVisitor::new();
            plan.visit(&mut visitor)?;
            let Some(table_name) = visitor.table_name else {
                return Ok(Transformed::new(plan, false, TreeNodeRecursion::Stop));
            };
            let index_fields = self
                .index_fields
                .get(&table_name)
                .cloned()
                .unwrap_or(HashSet::new());

            // check if the query is simple topn or simple distinct
            if let Some(index_optimize_mode) =
                is_simple_topn(Arc::clone(&plan), index_fields.clone())
            {
                // Check for SimpleTopN
                let mut rewriter = IndexOptimizerRewrite::new(index_optimize_mode);
                let plan = plan.rewrite(&mut rewriter)?.data;
                return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
            } else if let Some(index_optimize_mode) =
                is_simple_distinct(Arc::clone(&plan), index_fields.clone())
            {
                // Check for SimpleDistinct
                let mut rewriter = IndexOptimizerRewrite::new(index_optimize_mode);
                let plan = plan.rewrite(&mut rewriter)?.data;
                return Ok(Transformed::new(plan, true, TreeNodeRecursion::Stop));
            } else {
                return Ok(Transformed::new(plan, false, TreeNodeRecursion::Continue));
            }
        }
        Ok(Transformed::no(plan))
    }
}

#[derive(Debug)]
struct IndexOptimizerRewrite {
    index_optimizer_mode: IndexOptimizeMode,
}

impl IndexOptimizerRewrite {
    fn new(index_optimizer_mode: IndexOptimizeMode) -> Self {
        IndexOptimizerRewrite {
            index_optimizer_mode,
        }
    }
}

impl TreeNodeRewriter for IndexOptimizerRewrite {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Arc<dyn ExecutionPlan>) -> Result<Transformed<Self::Node>> {
        if let Some(remote) = node.as_any().downcast_ref::<RemoteScanExec>() {
            let remote = Arc::new(
                remote
                    .clone()
                    .set_index_optimize_mode(self.index_optimizer_mode.clone()),
            ) as Arc<dyn ExecutionPlan>;
            return Ok(Transformed::new(remote, true, TreeNodeRecursion::Stop));
        }
        Ok(Transformed::no(node))
    }
}

// visit physical plan to get underlying table name
struct TableNameVisitor {
    table_name: Option<TableReference>,
}

impl TableNameVisitor {
    pub fn new() -> Self {
        Self { table_name: None }
    }
}

impl<'n> TreeNodeVisitor<'n> for TableNameVisitor {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: &'n Self::Node) -> Result<TreeNodeRecursion> {
        let name = node.name();
        if name == "NewEmptyExec" {
            let table = node.as_any().downcast_ref::<NewEmptyExec>().unwrap();
            self.table_name = Some(TableReference::from(table.name()));
            Ok(TreeNodeRecursion::Stop)
        } else {
            Ok(TreeNodeRecursion::Continue)
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::{HashMap, HashSet},
        sync::Arc,
    };

    use arrow::datatypes::{DataType, Field, Schema};
    use datafusion::{
        execution::{SessionStateBuilder, runtime_env::RuntimeEnvBuilder},
        physical_plan::ExecutionPlan,
        prelude::{SessionConfig, SessionContext},
    };

    use super::*;
    use crate::service::search::datafusion::{
        distributed_plan::node::RemoteScanNode,
        optimizer::physical_optimizer::{
            index_optimizer::utils::tests::get_remote_scan, remote_scan::RemoteScanRule,
        },
        table_provider::empty_table::NewEmptyTable,
    };

    #[test]
    fn test_table_name_visitor_extracts_table_name_from_new_empty_exec() {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        let plan: Arc<dyn ExecutionPlan> = Arc::new(NewEmptyExec::new(
            "my_table",
            schema.clone(),
            None,
            &[],
            None,
            false,
            schema.clone(),
        ));

        let mut visitor = TableNameVisitor::new();
        plan.visit(&mut visitor).unwrap();
        let table = visitor.table_name.expect("table name should be found");
        assert_eq!(
            table.to_string(),
            TableReference::from("my_table").to_string()
        );
    }

    #[test]
    fn test_index_optimizer_rewrite_transforms_remote_scan_exec() {
        // Build a minimal child plan and a default RemoteScanExec
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        let child: Arc<dyn ExecutionPlan> = Arc::new(NewEmptyExec::new(
            "child",
            schema.clone(),
            None,
            &[],
            None,
            false,
            schema.clone(),
        ));

        let remote_node = RemoteScanNode::default();
        let remote = RemoteScanExec::new(Arc::clone(&child), remote_node)
            .expect("construct remote scan exec");
        let plan: Arc<dyn ExecutionPlan> = Arc::new(remote);

        // Apply rewrite with a concrete mode and assert it reports transformed=true
        let mode = IndexOptimizeMode::SimpleTopN("field".to_string(), 10, true);
        let mut rewriter = IndexOptimizerRewrite::new(mode.clone());
        let result = plan.rewrite(&mut rewriter).unwrap();
        assert!(result.transformed, "plan should be marked as transformed");
        assert_eq!(result.data.name(), "RemoteScanExec");
        let remote_scan = result
            .data
            .as_any()
            .downcast_ref::<RemoteScanExec>()
            .unwrap();
        assert_eq!(remote_scan.index_optimize_mode(), Some(mode));
    }

    #[tokio::test]
    async fn test_follower_rule_sets_mode_for_simple_select() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        let index_optimizer_mode = Arc::new(Mutex::new(None));
        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_physical_optimizer_rule(Arc::new(FollowerIndexOptimizerRule::new(
                (0, 0),
                index_optimizer_mode.clone(),
            )))
            .with_default_features()
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("t", schema.clone()).with_partitions(12);
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "SELECT * FROM t ORDER BY _timestamp DESC LIMIT 10";
        let plan = ctx.state().create_logical_plan(sql).await.unwrap();
        let _plan = ctx.state().create_physical_plan(&plan).await.unwrap();

        assert_eq!(
            index_optimizer_mode.lock().clone(),
            Some(IndexOptimizeMode::SimpleSelect(10, false))
        );
    }

    #[tokio::test]
    async fn test_follower_rule_sets_mode_for_simple_count() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));

        let index_optimizer_mode = Arc::new(Mutex::new(None));
        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_physical_optimizer_rule(Arc::new(FollowerIndexOptimizerRule::new(
                (0, 0),
                index_optimizer_mode.clone(),
            )))
            .with_default_features()
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("t", schema.clone()).with_partitions(12);
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "SELECT count(*) FROM t";
        let plan = ctx.state().create_logical_plan(sql).await.unwrap();
        let _plan = ctx.state().create_physical_plan(&plan).await.unwrap();

        assert_eq!(
            index_optimizer_mode.lock().clone(),
            Some(IndexOptimizeMode::SimpleCount)
        );
    }

    #[tokio::test]
    async fn test_leader_rule_topn() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("id", DataType::Utf8, false),
        ]));
        let mut index_fields: HashMap<TableReference, HashSet<String>> = HashMap::new();
        index_fields.insert(
            TableReference::from("t"),
            HashSet::from(["name".to_string()]),
        );

        let mut file_id_lists = hashbrown::HashMap::new();
        file_id_lists.insert(TableReference::from("t"), vec![]);
        let remote_scan_rule = RemoteScanRule::new_test(file_id_lists, false);

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_physical_optimizer_rule(Arc::new(remote_scan_rule))
            .with_physical_optimizer_rule(Arc::new(LeaderIndexOptimizerRule::new(index_fields)))
            .with_default_features()
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("t", schema.clone()).with_partitions(12);
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "select name, count(*) as cnt from t group by name order by cnt desc limit 10";
        let plan = ctx.state().create_logical_plan(sql).await.unwrap();
        let plan = ctx.state().create_physical_plan(&plan).await.unwrap();

        let remote_scan = get_remote_scan(plan);
        assert_eq!(
            remote_scan[0].index_optimize_mode(),
            Some(IndexOptimizeMode::SimpleTopN("name".to_string(), 10, false))
        )
    }

    #[tokio::test]
    async fn test_leader_rule_distinct() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
            Field::new("id", DataType::Utf8, false),
        ]));
        let mut index_fields: HashMap<TableReference, HashSet<String>> = HashMap::new();
        index_fields.insert(
            TableReference::from("t"),
            HashSet::from(["name".to_string()]),
        );

        let mut file_id_lists = hashbrown::HashMap::new();
        file_id_lists.insert(TableReference::from("t"), vec![]);
        let remote_scan_rule = RemoteScanRule::new_test(file_id_lists, false);

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_physical_optimizer_rule(Arc::new(remote_scan_rule))
            .with_physical_optimizer_rule(Arc::new(LeaderIndexOptimizerRule::new(index_fields)))
            .with_default_features()
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("t", schema.clone()).with_partitions(12);
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "select distinct name from t group by name order by name limit 10";
        let plan = ctx.state().create_logical_plan(sql).await.unwrap();
        let plan = ctx.state().create_physical_plan(&plan).await.unwrap();

        let remote_scan = get_remote_scan(plan);
        assert_eq!(
            remote_scan[0].index_optimize_mode(),
            Some(IndexOptimizeMode::SimpleDistinct(
                "name".to_string(),
                10,
                true
            ))
        )
    }

    #[tokio::test]
    async fn test_leader_rule_subquery() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("kubernetes_namespace_name", DataType::Utf8, false),
            Field::new("kubernetes_container_name", DataType::Utf8, false),
            Field::new("log", DataType::Utf8, false),
        ]));
        let mut index_fields: HashMap<TableReference, HashSet<String>> = HashMap::new();
        index_fields.insert(
            TableReference::from("t"),
            HashSet::from(["kubernetes_namespace_name".to_string()]),
        );

        let mut file_id_lists = hashbrown::HashMap::new();
        file_id_lists.insert(TableReference::from("t"), vec![]);
        let remote_scan_rule = RemoteScanRule::new_test(file_id_lists, false);

        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_physical_optimizer_rule(Arc::new(remote_scan_rule))
            .with_physical_optimizer_rule(Arc::new(LeaderIndexOptimizerRule::new(index_fields)))
            .with_default_features()
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("t", schema.clone()).with_partitions(12);
        ctx.register_table("t", Arc::new(provider)).unwrap();

        let sql = "select kubernetes_namespace_name,
                                      array_agg(distinct kubernetes_container_name) as container_name
                                    from t
                                    where log like '%zinc%'
                                    and kubernetes_namespace_name in (
                                        select distinct kubernetes_namespace_name
                                        from t
                                        order by kubernetes_namespace_name limit 10000)
                                    group by kubernetes_namespace_name
                                    order by kubernetes_namespace_name
                                    limit 10";
        let plan = ctx.state().create_logical_plan(sql).await.unwrap();
        let plan = ctx.state().create_physical_plan(&plan).await.unwrap();

        let remote_scan = get_remote_scan(plan);
        assert_eq!(
            remote_scan[0].index_optimize_mode(),
            Some(IndexOptimizeMode::SimpleDistinct(
                "kubernetes_namespace_name".to_string(),
                10000,
                true
            ))
        )
    }
}
