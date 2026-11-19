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

use std::sync::Arc;

use arrow_schema::FieldRef;
use datafusion::{
    arrow::{array::ArrayRef, datatypes::DataType},
    common::Result,
    functions_aggregate::percentile_cont::percentile_cont_udaf,
    logical_expr::{
        Accumulator, AggregateUDF, AggregateUDFImpl, Documentation, GroupsAccumulator, Signature,
        function::{AccumulatorArgs, AggregateFunctionSimplification, StateFieldsArgs},
    },
    scalar::ScalarValue,
};

/// `percentile_cont` whose ungrouped accumulator merges every state row; DataFusion's merges
/// only the first row, which drops states once batches get coalesced between Partial and Final.
#[derive(Debug, Hash, Eq, PartialEq)]
pub struct PercentileCont {
    inner: Arc<AggregateUDF>,
}

impl PercentileCont {
    pub fn new() -> Self {
        Self {
            inner: percentile_cont_udaf(),
        }
    }
}

impl Default for PercentileCont {
    fn default() -> Self {
        Self::new()
    }
}

impl AggregateUDFImpl for PercentileCont {
    fn name(&self) -> &str {
        self.inner.name()
    }

    fn aliases(&self) -> &[String] {
        self.inner.aliases()
    }

    fn signature(&self) -> &Signature {
        self.inner.signature()
    }

    fn return_type(&self, arg_types: &[DataType]) -> Result<DataType> {
        self.inner.return_type(arg_types)
    }

    fn state_fields(&self, args: StateFieldsArgs) -> Result<Vec<FieldRef>> {
        self.inner.state_fields(args)
    }

    fn accumulator(&self, args: AccumulatorArgs) -> Result<Box<dyn Accumulator>> {
        let is_distinct = args.is_distinct;
        let acc = self.inner.accumulator(args)?;
        if is_distinct {
            return Ok(acc);
        }
        Ok(Box::new(MergeAllRowsAccumulator(acc)))
    }

    fn groups_accumulator_supported(&self, args: AccumulatorArgs) -> bool {
        self.inner.groups_accumulator_supported(args)
    }

    fn create_groups_accumulator(
        &self,
        args: AccumulatorArgs,
    ) -> Result<Box<dyn GroupsAccumulator>> {
        self.inner.create_groups_accumulator(args)
    }

    fn order_sensitivity(&self) -> datafusion::logical_expr::utils::AggregateOrderSensitivity {
        self.inner.order_sensitivity()
    }

    fn simplify(&self) -> Option<AggregateFunctionSimplification> {
        self.inner.simplify()
    }

    fn supports_within_group_clause(&self) -> bool {
        self.inner.inner().supports_within_group_clause()
    }

    fn documentation(&self) -> Option<&Documentation> {
        self.inner.documentation()
    }
}

#[derive(Debug)]
struct MergeAllRowsAccumulator(Box<dyn Accumulator>);

impl Accumulator for MergeAllRowsAccumulator {
    fn state(&mut self) -> Result<Vec<ScalarValue>> {
        self.0.state()
    }

    fn update_batch(&mut self, values: &[ArrayRef]) -> Result<()> {
        self.0.update_batch(values)
    }

    fn merge_batch(&mut self, states: &[ArrayRef]) -> Result<()> {
        let rows = states.first().map_or(0, |s| s.len());
        for row in 0..rows {
            let one_row: Vec<ArrayRef> = states.iter().map(|s| s.slice(row, 1)).collect();
            self.0.merge_batch(&one_row)?;
        }
        Ok(())
    }

    fn evaluate(&mut self) -> Result<ScalarValue> {
        self.0.evaluate()
    }

    fn size(&self) -> usize {
        self.0.size()
    }

    fn retract_batch(&mut self, values: &[ArrayRef]) -> Result<()> {
        self.0.retract_batch(values)
    }

    fn supports_retract_batch(&self) -> bool {
        self.0.supports_retract_batch()
    }
}

#[cfg(test)]
mod tests {
    use datafusion::{
        arrow::{
            array::{Array, Float64Array, ListArray, RecordBatch},
            datatypes::{Field, Float64Type, Schema},
        },
        common::tree_node::{Transformed, TreeNode, TreeNodeRecursion},
        datasource::MemTable,
        execution::FunctionRegistry,
        physical_expr::expressions::{col, lit},
        physical_plan::{
            ChildrenPropertiesMode, ExecutionPlan, Partitioning, ReplaceChildrenOptions,
            aggregates::AggregateExec, collect, repartition::RepartitionExec,
        },
        prelude::{SessionConfig, SessionContext},
    };
    use datafusion_proto::bytes::{
        physical_plan_from_bytes_with_extension_codec, physical_plan_to_bytes_with_extension_codec,
    };

    use super::*;
    use crate::datafusion::{
        distributed::codec::get_physical_extension_codec, exec::register_builtin_udfs,
    };

    fn state_batch(rows: &[&[f64]]) -> ArrayRef {
        let lists = rows
            .iter()
            .map(|r| Some(r.iter().map(|v| Some(*v)).collect::<Vec<_>>()));
        Arc::new(ListArray::from_iter_primitive::<Float64Type, _, _>(lists))
    }

    fn new_acc(udaf: &AggregateUDF) -> Box<dyn Accumulator> {
        let schema = Schema::new(vec![Field::new("a", DataType::Float64, false)]);
        let field: FieldRef = Arc::new(Field::new("a", DataType::Float64, false));
        let exprs = [col("a", &schema).unwrap(), lit(0.5f64)];
        let expr_fields = [
            field.clone(),
            Arc::new(Field::new("p", DataType::Float64, false)),
        ];
        udaf.accumulator(AccumulatorArgs {
            return_field: field,
            schema: &schema,
            ignore_nulls: false,
            order_bys: &[],
            is_reversed: false,
            name: "p50",
            is_distinct: false,
            exprs: &exprs,
            expr_fields: &expr_fields,
        })
        .unwrap()
    }

    fn merge_two_multi_row_batches(udaf: &AggregateUDF) -> ScalarValue {
        let mut acc = new_acc(udaf);
        acc.merge_batch(&[state_batch(&[&[1.0, 2.0], &[3.0, 4.0]])])
            .unwrap();
        acc.merge_batch(&[state_batch(&[&[5.0], &[6.0, 7.0, 8.0]])])
            .unwrap();
        acc.evaluate().unwrap()
    }

    #[test]
    fn test_wrapper_merges_every_state_row() {
        let wrapped = AggregateUDF::from(PercentileCont::new());
        assert_eq!(
            merge_two_multi_row_batches(&wrapped),
            ScalarValue::Float64(Some(4.5))
        );
    }

    #[test]
    fn test_registered_percentile_cont_resolves_to_wrapper() {
        let ctx = SessionContext::new();
        register_builtin_udfs(&ctx);
        let udaf = ctx.udaf("percentile_cont").unwrap();
        assert!(udaf.inner().is::<PercentileCont>());
        assert!(
            ctx.udaf("quantile_cont")
                .unwrap()
                .inner()
                .is::<PercentileCont>()
        );
    }

    async fn partial_final_plan(ctx: &SessionContext) -> Arc<dyn ExecutionPlan> {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Float64, false)]));
        let parts: Vec<Vec<RecordBatch>> = (0..8)
            .map(|i| {
                let col: ArrayRef = Arc::new(Float64Array::from(vec![i as f64]));
                vec![RecordBatch::try_new(schema.clone(), vec![col]).unwrap()]
            })
            .collect();
        ctx.register_table("t", Arc::new(MemTable::try_new(schema, parts).unwrap()))
            .unwrap();
        ctx.sql("select percentile_cont(0.5) within group (order by a) as p from t")
            .await
            .unwrap()
            .create_physical_plan()
            .await
            .unwrap()
    }

    fn with_round_robin_repartition(plan: Arc<dyn ExecutionPlan>) -> Arc<dyn ExecutionPlan> {
        plan.transform_up(|n| {
            if n.name() == "CoalescePartitionsExec" {
                let child = n.children()[0].clone();
                let rr = Arc::new(RepartitionExec::try_new(
                    child,
                    Partitioning::RoundRobinBatch(4),
                )?);
                return Ok(Transformed::yes(n.replace_children(
                    vec![rr],
                    ReplaceChildrenOptions::new(ChildrenPropertiesMode::Recompute),
                )?));
            }
            Ok(Transformed::no(n))
        })
        .unwrap()
        .data
    }

    fn aggregate_udafs_are_wrapper(plan: &Arc<dyn ExecutionPlan>) -> bool {
        let mut all_wrapper = true;
        let mut seen = 0;
        plan.apply(|n| {
            if let Some(agg) = n.downcast_ref::<AggregateExec>() {
                for e in agg.aggr_expr() {
                    seen += 1;
                    all_wrapper &= e.fun().inner().is::<PercentileCont>();
                }
            }
            Ok(TreeNodeRecursion::Continue)
        })
        .unwrap();
        seen > 0 && all_wrapper
    }

    async fn median_of(plan: Arc<dyn ExecutionPlan>, ctx: &SessionContext) -> f64 {
        let out = collect(plan, ctx.task_ctx()).await.unwrap();
        out[0]
            .column(0)
            .as_any()
            .downcast_ref::<Float64Array>()
            .unwrap()
            .value(0)
    }

    fn new_ctx() -> SessionContext {
        let ctx = SessionContext::new_with_config(SessionConfig::new().with_target_partitions(8));
        register_builtin_udfs(&ctx);
        ctx
    }

    #[tokio::test]
    async fn test_final_over_coalesced_partial_states_is_exact() {
        let ctx = new_ctx();
        let plan = with_round_robin_repartition(partial_final_plan(&ctx).await);
        assert!(aggregate_udafs_are_wrapper(&plan));
        assert_eq!(median_of(plan, &ctx).await, 3.5);
    }

    #[tokio::test]
    async fn test_decoded_plan_resolves_wrapper_and_is_exact() {
        let codec = get_physical_extension_codec();
        let leader = new_ctx();
        let plan = with_round_robin_repartition(partial_final_plan(&leader).await);
        let bytes = physical_plan_to_bytes_with_extension_codec(plan, &codec).unwrap();

        // the remote node builds its decode context the same way: register_builtin_udfs
        let remote = new_ctx();
        let decoded =
            physical_plan_from_bytes_with_extension_codec(&bytes, &remote.task_ctx(), &codec)
                .unwrap();
        assert!(aggregate_udafs_are_wrapper(&decoded));
        assert_eq!(median_of(decoded, &remote).await, 3.5);
    }
}
