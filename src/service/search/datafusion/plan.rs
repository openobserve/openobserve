// Copyright 2024 Zinc Labs Inc.
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

use arrow::array::RecordBatch;
use datafusion::physical_plan::{
    coalesce_batches::CoalesceBatchesExec, memory::MemoryExec, repartition::RepartitionExec,
    ExecutionPlan, Partitioning,
};

pub fn get_partial_plan(
    plan: &Arc<dyn ExecutionPlan>,
) -> Result<Option<Arc<dyn ExecutionPlan>>, datafusion::error::DataFusionError> {
    if plan.children().is_empty() {
        return Ok(None);
    }
    if plan.children().len() > 1 {
        return Err(datafusion::error::DataFusionError::NotImplemented(format!(
            "ExecutionPlan with multiple children"
        )));
    }
    if let Some(cplan) = plan.children().into_iter().next() {
        println!("get_partial_plan: {:?}", cplan.name());
        for name in ["HashJoinExec", "CrossJoinExec"] {
            if cplan.name() == name {
                return Err(datafusion::error::DataFusionError::NotImplemented(
                    name.to_string(),
                ));
            }
        }
        for name in [
            "CoalescePartitionsExec",
            "RepartitionExec",
            "SortPreservingMergeExec",
        ] {
            if cplan.name() == "RepartitionExec" {
                let plan = cplan.as_any().downcast_ref::<RepartitionExec>().unwrap();
                if let Partitioning::RoundRobinBatch(_) = plan.partitioning() {
                    return Ok(None);
                }
            } else if cplan.name() == name {
                let child = *cplan.children().first().unwrap();
                if child.name() == "ParquetExec" {
                    return Ok(None);
                }
                if let Some(v) = get_partial_plan(child)? {
                    return Ok(Some(v));
                } else {
                    if cplan.name() == "SortPreservingMergeExec" {
                        return Ok(Some(cplan.clone()));
                    }
                    return Ok(Some(child.clone()));
                }
            }
        }
        return get_partial_plan(cplan);
    }
    Ok(Some(plan.clone()))
}

pub fn get_final_plan(
    plan: &Arc<dyn ExecutionPlan>,
    data: Vec<Vec<RecordBatch>>,
) -> Result<(Option<Arc<dyn ExecutionPlan>>, bool), datafusion::error::DataFusionError> {
    if plan.children().is_empty() {
        return Ok((Some(plan.clone()), false));
    }
    if plan.children().len() > 1 {
        return Err(datafusion::error::DataFusionError::NotImplemented(format!(
            "ExecutionPlan with multiple children"
        )));
    }
    let mut found_dist = false;
    let mut cplan = plan.children()[0].clone();
    for name in ["HashJoinExec", "CrossJoinExec"] {
        if cplan.name() == name {
            return Err(datafusion::error::DataFusionError::NotImplemented(
                name.to_string(),
            ));
        }
    }
    if cplan.name() == "CoalescePartitionsExec" {
        let child = *cplan.children().first().unwrap();
        if let Some(_) = get_partial_plan(child)? {
            if let (Some(v), dist) = get_final_plan(&cplan, data)? {
                cplan = v;
                if dist {
                    found_dist = true;
                }
            }
        } else {
            cplan = cplan
                .clone()
                .with_new_children(vec![Arc::new(
                    MemoryExec::try_new(&data, cplan.schema(), None).unwrap(),
                )])
                .unwrap();
            found_dist = true;
        }
    } else if cplan.name() == "RepartitionExec" {
        let child = *cplan.children().first().unwrap();
        if let Some(_) = get_partial_plan(child)? {
            if let (Some(v), dist) = get_final_plan(&cplan, data)? {
                cplan = v;
                if dist {
                    found_dist = true;
                }
            }
        } else {
            cplan = cplan
                .clone()
                .with_new_children(vec![Arc::new(
                    MemoryExec::try_new(&data, cplan.schema(), None).unwrap(),
                )])
                .unwrap();
            found_dist = true;
        }
    } else if cplan.name() == "SortPreservingMergeExec" {
        let child = *cplan.children().first().unwrap();
        if let Some(_) = get_partial_plan(child)? {
            if let (Some(v), dist) = get_final_plan(&cplan, data)? {
                cplan = v;
                if dist {
                    found_dist = true;
                }
            }
        } else {
            cplan = cplan
                .clone()
                .with_new_children(vec![Arc::new(
                    MemoryExec::try_new(&data, cplan.schema(), None).unwrap(),
                )])
                .unwrap();
            found_dist = true;
        }
    } else if let (Some(v), dist) = get_final_plan(&cplan, data)? {
        cplan = v;
        if dist {
            found_dist = true;
        }
    }
    Ok((
        Some(plan.clone().with_new_children(vec![cplan]).unwrap()),
        found_dist,
    ))
}

pub fn get_without_dist_plan(
    plan: &Arc<dyn ExecutionPlan>,
    data: Vec<Vec<RecordBatch>>,
    batch_size: usize,
) -> Arc<dyn ExecutionPlan> {
    let memory_exec = MemoryExec::try_new(&data, plan.schema(), None).unwrap();
    let coalesce_exec = CoalesceBatchesExec::new(Arc::new(memory_exec), batch_size);
    plan.clone()
        .with_new_children(vec![Arc::new(coalesce_exec)])
        .unwrap()
}
