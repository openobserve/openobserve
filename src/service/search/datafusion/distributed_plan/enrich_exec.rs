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

use config::utils::record_batch_ext::convert_json_to_record_batch;
use datafusion::{
    arrow::{array::RecordBatch, datatypes::SchemaRef},
    common::{Result, Statistics},
    execution::{SendableRecordBatchStream, TaskContext},
    physical_expr::{EquivalenceProperties, Partitioning},
    physical_plan::{
        DisplayAs, DisplayFormatType, ExecutionPlan, PlanProperties, common,
        execution_plan::{Boundedness, EmissionType},
        internal_err,
        memory::MemoryStream,
        stream::RecordBatchStreamAdapter,
    },
};
use futures::TryStreamExt;

#[derive(Debug)]
pub struct NewEnrichExec {
    org_id: String,
    name: String,
    schema: SchemaRef, // The schema for the produced row
    partitions: usize, // Number of partitions
    cache: PlanProperties,
}

impl NewEnrichExec {
    /// Create a new NewEnrichExec
    pub fn new(org_id: &str, name: &str, schema: SchemaRef) -> Self {
        let cache = Self::compute_properties(Arc::clone(&schema), 1);
        NewEnrichExec {
            org_id: org_id.to_string(),
            name: name.to_string(),
            schema,
            partitions: 1,
            cache,
        }
    }

    /// Create a new NewEnrichExec with specified partition number
    pub fn with_partitions(mut self, partitions: usize) -> Self {
        self.partitions = partitions;
        // Changing partitions may invalidate output partitioning, so update it:
        let output_partitioning = Self::output_partitioning_helper(self.partitions);
        self.cache = self.cache.with_partitioning(output_partitioning);
        self
    }

    fn data(&self) -> Result<Vec<RecordBatch>> {
        Ok(vec![])
    }

    fn output_partitioning_helper(n_partitions: usize) -> Partitioning {
        Partitioning::UnknownPartitioning(n_partitions)
    }

    /// This function creates the cache object that stores the plan properties such as schema,
    /// equivalence properties, ordering, partitioning, etc.
    fn compute_properties(schema: SchemaRef, n_partitions: usize) -> PlanProperties {
        let eq_properties = EquivalenceProperties::new(schema);
        let output_partitioning = Self::output_partitioning_helper(n_partitions);
        PlanProperties::new(
            eq_properties,
            // Output Partitioning
            output_partitioning,
            // Execution Mode
            EmissionType::Incremental,
            Boundedness::Bounded,
        )
    }
}

impl DisplayAs for NewEnrichExec {
    fn fmt_as(&self, t: DisplayFormatType, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match t {
            DisplayFormatType::Default | DisplayFormatType::Verbose => {
                let name_string = format!("name={:?}", self.name);
                let projection_string = format!(
                    ", projection={:?}",
                    self.schema
                        .fields()
                        .iter()
                        .map(|f| f.name())
                        .collect::<Vec<_>>()
                );

                write!(f, "NewEnrichExec: ")?;
                write!(f, "{}{}", name_string, projection_string,)
            }
        }
    }
}

impl ExecutionPlan for NewEnrichExec {
    fn name(&self) -> &'static str {
        "NewEnrichExec"
    }

    /// Return a reference to Any that can be used for downcasting
    fn as_any(&self) -> &dyn Any {
        self
    }

    fn properties(&self) -> &PlanProperties {
        &self.cache
    }

    fn children(&self) -> Vec<&Arc<dyn ExecutionPlan>> {
        vec![]
    }

    fn with_new_children(
        self: Arc<Self>,
        _: Vec<Arc<dyn ExecutionPlan>>,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        Ok(self)
    }

    fn execute(
        &self,
        _partition: usize,
        _context: Arc<TaskContext>,
    ) -> Result<SendableRecordBatchStream> {
        let data = get_data(self.org_id.clone(), self.name.clone(), self.schema.clone());
        let stream = futures::stream::once(data).try_flatten();
        Ok(Box::pin(RecordBatchStreamAdapter::new(
            self.schema.clone(),
            stream,
        )))
    }

    fn statistics(&self) -> Result<Statistics> {
        let batch = self
            .data()
            .expect("Create empty RecordBatch should not fail");
        Ok(common::compute_record_batch_statistics(
            &[batch],
            &self.schema,
            None,
        ))
    }
}

async fn get_data(
    org_id: String,
    name: String,
    schema: SchemaRef,
) -> Result<SendableRecordBatchStream> {
    let clean_name = name.trim_matches('"');
    log::info!("[EnrichExec] get_data: {org_id}/{clean_name}");
    let data = match crate::service::db::enrichment_table::get_enrichment_data_from_db(
        &org_id,
        &clean_name,
    )
    .await
    {
        Ok((data, _min_ts, _max_ts)) => data.into_iter().map(Arc::new).collect::<Vec<_>>(),
        Err(e) => return internal_err!("get enrichment data from db: {e}"),
    };
    log::info!("[EnrichExec] get_data: {org_id}/{clean_name} db data: {:?}", data);

    let batch = match convert_json_to_record_batch(&schema, &data) {
        Ok(batch) => batch,
        Err(e) => return internal_err!("convert enrichment data from json to record batch: {e}"),
    };
    log::info!("[EnrichExec] get_data: {org_id}/{clean_name} batch data: {:?}", batch.num_rows());

    // convert data to RecordBatch
    Ok(Box::pin(MemoryStream::try_new(
        vec![batch],
        Arc::clone(&schema),
        None,
    )?))
}

// add some unit tests here
#[cfg(test)]
mod tests {
    use arrow::datatypes::{DataType, Field, Schema};

    use super::*;

    #[test]
    fn test_new_enrich_exec() {
        let schema = Arc::new(Schema::new(vec![Field::new("a", DataType::Int32, false)]));
        let exec = NewEnrichExec::new("default", "test", schema.clone());
        assert_eq!(exec.org_id, "default");
        assert_eq!(exec.name, "test");
        assert_eq!(exec.partitions, 1);
    }
}
