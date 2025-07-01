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

use std::{any::Any, sync::Arc};

use arrow_schema::{Field, Schema, SchemaRef};
use async_trait::async_trait;
use datafusion::{
    catalog::Session,
    common::Result,
    datasource::TableProvider,
    logical_expr::{Expr, TableProviderFilterPushDown, TableType},
    physical_expr::calculate_union,
    physical_plan::{
        ExecutionPlan, ExecutionPlanProperties, Partitioning, PlanProperties,
        empty::EmptyExec,
        execution_plan::{Boundedness, EmissionType},
        union::UnionExec,
    },
};
use itertools::Itertools;

#[derive(Debug)]
pub(crate) struct NewUnionTable {
    trace_id: Option<String>,
    schema: SchemaRef,
    tables: Vec<Arc<dyn TableProvider>>,
}

impl NewUnionTable {
    /// Create a new in-memory table from the provided schema and record batches
    pub fn new(
        trace_id: Option<String>,
        schema: SchemaRef,
        tables: Vec<Arc<dyn TableProvider>>,
    ) -> Self {
        Self {
            trace_id,
            schema,
            tables,
        }
    }
}

#[async_trait]
impl TableProvider for NewUnionTable {
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn schema(&self) -> SchemaRef {
        Arc::clone(&self.schema)
    }

    fn table_type(&self) -> TableType {
        TableType::Base
    }

    async fn scan(
        &self,
        state: &dyn Session,
        projection: Option<&Vec<usize>>,
        filters: &[Expr],
        limit: Option<usize>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        if self.tables.is_empty() {
            return Ok(Arc::new(EmptyExec::new(self.schema())));
        }
        if self.tables.len() == 1 {
            return self.tables[0].scan(state, projection, filters, limit).await;
        }
        let mut table_plans = Vec::new();
        for table in self.tables.iter() {
            let plan = table.scan(state, projection, filters, limit).await?;
            table_plans.push(plan);
        }

        let schema = union_schema(&table_plans);
        if let Err(e) = compute_properties(&table_plans, schema) {
            log::error!(
                "[trace_id {}] compute_properties error: {}",
                self.trace_id.as_ref().unwrap_or(&"".to_string()),
                e
            );
            for (i, plan) in table_plans.iter().enumerate() {
                log::error!(
                    "[trace_id {}] plan {i} schema: {}",
                    self.trace_id.as_ref().unwrap_or(&"".to_string()),
                    plan.schema().to_string()
                );
            }
        }

        Ok(Arc::new(UnionExec::new(table_plans)))
    }

    fn supports_filters_pushdown(
        &self,
        filters: &[&Expr],
    ) -> Result<Vec<TableProviderFilterPushDown>> {
        Ok(vec![TableProviderFilterPushDown::Inexact; filters.len()])
    }
}

fn union_schema(inputs: &[Arc<dyn ExecutionPlan>]) -> SchemaRef {
    let first_schema = inputs[0].schema();

    let fields = (0..first_schema.fields().len())
        .map(|i| {
            inputs
                .iter()
                .enumerate()
                .map(|(input_idx, input)| {
                    let field = input.schema().field(i).clone();
                    let mut metadata = field.metadata().clone();

                    let other_metadatas = inputs
                        .iter()
                        .enumerate()
                        .filter(|(other_idx, _)| *other_idx != input_idx)
                        .flat_map(|(_, other_input)| {
                            other_input.schema().field(i).metadata().clone().into_iter()
                        });

                    metadata.extend(other_metadatas);
                    field.with_metadata(metadata)
                })
                .find_or_first(Field::is_nullable)
                // We can unwrap this because if inputs was empty, this would've already panic'ed when we
                // indexed into inputs[0].
                .unwrap()
        })
        .collect::<Vec<_>>();

    let all_metadata_merged = inputs
        .iter()
        .flat_map(|i| i.schema().metadata().clone().into_iter())
        .collect();

    Arc::new(Schema::new_with_metadata(fields, all_metadata_merged))
}

/// This function creates the cache object that stores the plan properties such as schema,
/// equivalence properties, ordering, partitioning, etc.
fn compute_properties(
    inputs: &[Arc<dyn ExecutionPlan>],
    schema: SchemaRef,
) -> Result<PlanProperties> {
    // Calculate equivalence properties:
    let children_eqps = inputs
        .iter()
        .map(|child| child.equivalence_properties().clone())
        .collect::<Vec<_>>();
    let eq_properties = calculate_union(children_eqps, schema)?;

    Ok(PlanProperties::new(
        eq_properties,
        Partitioning::UnknownPartitioning(inputs.len()),
        EmissionType::Both,
        Boundedness::Bounded,
    ))
}
