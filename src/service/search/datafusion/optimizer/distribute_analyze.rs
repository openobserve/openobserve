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

use datafusion::{
    common::Result,
    physical_plan::{ExecutionPlan, analyze::AnalyzeExec},
};

use crate::service::search::datafusion::distributed_plan::distribute_analyze::DistributeAnalyzeExec;

// replace the AnalyzeExec to DistributeAnalyzeExec
pub fn optimize_distribute_analyze(plan: Arc<dyn ExecutionPlan>) -> Result<Arc<dyn ExecutionPlan>> {
    if let Some(analyze) = plan.as_any().downcast_ref::<AnalyzeExec>() {
        let distribute_analyze = DistributeAnalyzeExec::new(
            analyze.verbose(),
            analyze.show_statistics(),
            analyze.input().clone(),
            analyze.schema().clone(),
        );
        return Ok(Arc::new(distribute_analyze));
    }
    Ok(plan)
}
