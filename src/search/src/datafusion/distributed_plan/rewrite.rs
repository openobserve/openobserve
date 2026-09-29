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

use config::meta::stream::FileKey;
use datafusion::{
    arrow::datatypes::SchemaRef,
    common::{
        Result,
        tree_node::{Transformed, TreeNode, TreeNodeRewriter},
    },
    physical_plan::{
        ExecutionPlan,
        aggregates::{AggregateExec, AggregateMode},
        union::UnionExec,
    },
};

use crate::{
    datafusion::{
        distributed_plan::metadata_count_exec::MetadataCountExec,
        plan::tantivy_optimize_exec::TantivyOptimizeExec,
    },
    tantivy::aggregate::IndexAggregate,
};

pub fn aggregate_optimize_rewrite(
    metadata_count_file_list: Vec<FileKey>,
    index_aggregate: Option<IndexAggregate>,
    physical_plan: Arc<dyn ExecutionPlan>,
) -> Result<Arc<dyn ExecutionPlan>> {
    let metadata_records = metadata_count_file_list.iter().fold(0i64, |total, file| {
        total.saturating_add(file.meta.records.max(0))
    });
    let metadata_files = metadata_count_file_list.len();
    if metadata_records == 0 && index_aggregate.is_none() {
        return Ok(physical_plan);
    }

    let mut visitor =
        AggregateOptimizeRewriter::new(index_aggregate, metadata_records, metadata_files);
    Ok(physical_plan.rewrite(&mut visitor)?.data)
}

pub struct AggregateOptimizeRewriter {
    index_aggregate: Option<IndexAggregate>,
    metadata_records: i64,
    metadata_files: usize,
}

impl AggregateOptimizeRewriter {
    pub fn new(
        index_aggregate: Option<IndexAggregate>,
        metadata_records: i64,
        metadata_files: usize,
    ) -> Self {
        Self {
            index_aggregate,
            metadata_records,
            metadata_files,
        }
    }

    fn metadata_count_exec(&self, schema: SchemaRef) -> Result<Arc<dyn ExecutionPlan>> {
        Ok(Arc::new(MetadataCountExec::new(
            schema,
            self.metadata_records,
            self.metadata_files,
        )))
    }

    fn additional_inputs(&mut self, schema: SchemaRef) -> Result<Vec<Arc<dyn ExecutionPlan>>> {
        let mut inputs = Vec::new();

        if self.metadata_records > 0 {
            inputs.push(self.metadata_count_exec(schema.clone())?);
        }

        if let Some(aggregate) = self.index_aggregate.take() {
            inputs.push(Arc::new(TantivyOptimizeExec::try_new(
                schema,
                aggregate.files,
                aggregate.result,
                aggregate.mode,
            )?));
        }

        Ok(inputs)
    }
}

impl TreeNodeRewriter for AggregateOptimizeRewriter {
    type Node = Arc<dyn ExecutionPlan>;

    fn f_up(&mut self, node: Arc<dyn ExecutionPlan>) -> Result<Transformed<Self::Node>> {
        if let Some(aggregate) = node.downcast_ref::<AggregateExec>()
            && *aggregate.mode() == AggregateMode::Partial
        {
            let mut inputs = vec![node.clone()];
            inputs.extend(self.additional_inputs(node.schema())?);

            let new_node = UnionExec::try_new(inputs)?;
            return Ok(Transformed::complete(new_node));
        }

        Ok(Transformed::no(node))
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow::array::{Int64Array, RecordBatch, StringArray};
    use arrow_schema::{DataType, Field, Schema};
    use config::meta::{
        inverted_index::IndexOptimizeMode,
        stream::{FileKey, FileMeta},
    };
    use datafusion::{
        common::Result,
        execution::context::SessionConfig,
        functions_aggregate::count::count_udaf,
        physical_expr::aggregate::{AggregateExprBuilder, AggregateFunctionExpr},
        physical_plan::{
            ExecutionPlan, ExecutionPlanProperties,
            aggregates::{AggregateExec, AggregateMode, PhysicalGroupBy},
            coalesce_partitions::CoalescePartitionsExec,
            collect,
            empty::EmptyExec,
            expressions::lit,
            union::UnionExec,
        },
        prelude::{ParquetReadOptions, SessionContext},
    };
    use parquet::arrow::ArrowWriter;

    use super::*;
    use crate::tantivy::TantivyMultiResult;

    fn index_count(count: u64) -> Option<IndexAggregate> {
        Some(IndexAggregate {
            mode: IndexOptimizeMode::SimpleCount,
            files: vec![FileKey::default()],
            result: TantivyMultiResult::Count(count),
        })
    }

    fn partial_count_exec() -> Result<Arc<dyn ExecutionPlan>> {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "_timestamp",
            DataType::Int64,
            false,
        )]));
        let aggregate = Arc::new(
            AggregateExprBuilder::new(count_udaf(), vec![lit(1i32)])
                .schema(schema.clone())
                .alias("COUNT(*)")
                .build()?,
        );

        Ok(Arc::new(AggregateExec::try_new(
            AggregateMode::Partial,
            PhysicalGroupBy::default(),
            vec![aggregate],
            vec![None],
            Arc::new(EmptyExec::new(schema.clone())),
            schema,
        )?))
    }

    #[test]
    fn test_aggregate_optimize_rewrite_combines_metadata_and_tantivy_inputs() -> Result<()> {
        let plan = partial_count_exec()?;
        let metadata_files = vec![FileKey {
            meta: FileMeta {
                records: 11,
                ..Default::default()
            },
            ..Default::default()
        }];

        let rewritten = aggregate_optimize_rewrite(metadata_files, index_count(7), plan)?;

        let union = rewritten
            .downcast_ref::<UnionExec>()
            .expect("rewrite should wrap the partial aggregate in a union");
        let inputs = union.inputs();
        assert_eq!(inputs.len(), 3);
        assert_eq!(inputs[0].name(), "AggregateExec");
        assert_eq!(inputs[1].name(), "MetadataCountExec");
        assert_eq!(inputs[2].name(), "TantivyOptimizeExec");

        Ok(())
    }

    #[test]
    fn test_aggregate_optimize_rewrite_tantivy_only() -> Result<()> {
        let rewritten = aggregate_optimize_rewrite(vec![], index_count(7), partial_count_exec()?)?;

        let union = rewritten
            .downcast_ref::<UnionExec>()
            .expect("rewrite should wrap the partial aggregate in a union");
        let inputs = union.inputs();
        assert_eq!(inputs.len(), 2);
        assert_eq!(inputs[0].name(), "AggregateExec");
        assert_eq!(inputs[1].name(), "TantivyOptimizeExec");

        Ok(())
    }

    async fn fallback_parquet_ctx() -> Result<(tempfile::TempDir, SessionContext)> {
        let directory = tempfile::tempdir()?;
        let schema = Arc::new(Schema::new(vec![Field::new(
            "service_name",
            DataType::Utf8,
            true,
        )]));
        for part in 0..2 {
            let file = std::fs::File::create(directory.path().join(format!("{part}.parquet")))?;
            let mut writer = ArrowWriter::try_new(file, schema.clone(), None)?;
            writer.write(&RecordBatch::try_new(
                schema.clone(),
                vec![Arc::new(StringArray::from(vec![
                    Some("svc-a"),
                    Some("svc-b"),
                    None,
                ]))],
            )?)?;
            writer.close()?;
        }
        let ctx = SessionContext::new_with_config(
            SessionConfig::new()
                .with_target_partitions(2)
                .with_repartition_file_scans(false),
        );
        ctx.register_parquet(
            "fallback",
            directory.path().to_str().unwrap(),
            ParquetReadOptions::default(),
        )
        .await?;
        Ok((directory, ctx))
    }

    async fn partial_count_over(
        ctx: &SessionContext,
        sql: &str,
    ) -> Result<(Arc<dyn ExecutionPlan>, Arc<AggregateFunctionExpr>)> {
        let scan = ctx.sql(sql).await?.create_physical_plan().await?;
        let schema = scan.schema();
        let aggregate = Arc::new(
            AggregateExprBuilder::new(count_udaf(), vec![lit(1i32)])
                .schema(schema.clone())
                .alias("COUNT(*)")
                .build()?,
        );
        let partial = Arc::new(AggregateExec::try_new(
            AggregateMode::Partial,
            PhysicalGroupBy::default(),
            vec![aggregate.clone()],
            vec![None],
            scan,
            schema,
        )?);
        Ok((partial, aggregate))
    }

    #[tokio::test]
    async fn test_aggregate_rewrite_merges_parquet_fallback_with_index_count() -> Result<()> {
        let (_directory, ctx) = fallback_parquet_ctx().await?;
        let (partial, aggregate) = partial_count_over(
            &ctx,
            "SELECT service_name FROM fallback WHERE service_name = 'svc-a'",
        )
        .await?;
        assert_eq!(partial.output_partitioning().partition_count(), 2);
        let input_schema = partial.children()[0].schema();

        let merged = aggregate_optimize_rewrite(vec![], index_count(7), partial)?;
        assert_eq!(merged.output_partitioning().partition_count(), 3);

        let final_plan = Arc::new(AggregateExec::try_new(
            AggregateMode::Final,
            PhysicalGroupBy::default(),
            vec![aggregate],
            vec![None],
            Arc::new(CoalescePartitionsExec::new(merged)),
            input_schema,
        )?);
        let batches = collect(final_plan, ctx.task_ctx()).await?;
        let count = batches[0]
            .column(0)
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap()
            .value(0);
        assert_eq!(count, 9);

        Ok(())
    }

    #[tokio::test]
    async fn test_aggregate_rewrite_propagates_parquet_fallback_error() -> Result<()> {
        let (_directory, ctx) = fallback_parquet_ctx().await?;
        let (partial, _) = partial_count_over(
            &ctx,
            "SELECT 1 / (length(service_name) - 5) AS n FROM fallback",
        )
        .await?;

        let merged = aggregate_optimize_rewrite(vec![], index_count(7), partial)?;
        assert!(collect(merged, ctx.task_ctx()).await.is_err());

        Ok(())
    }
}
