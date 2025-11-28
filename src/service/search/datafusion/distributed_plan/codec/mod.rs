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
    common::Result, execution::TaskContext, logical_expr::ScalarUDF, physical_plan::ExecutionPlan,
};
use datafusion_proto::physical_plan::PhysicalExtensionCodec;

#[cfg(feature = "enterprise")]
mod aggregate_topk_exec;
mod empty_exec;
#[cfg(feature = "enterprise")]
mod enrichment_exec;
mod physical_plan_node;
#[cfg(feature = "enterprise")]
mod streaming_aggs_exec;
#[cfg(feature = "enterprise")]
mod tmp_exec;

pub fn get_physical_extension_codec() -> ComposedPhysicalExtensionCodec {
    ComposedPhysicalExtensionCodec {
        codecs: vec![Arc::new(
            physical_plan_node::PhysicalPlanNodePhysicalExtensionCodec {},
        )],
    }
}

/// A PhysicalExtensionCodec that tries one of multiple inner codecs
/// until one works
#[derive(Debug)]
pub struct ComposedPhysicalExtensionCodec {
    pub codecs: Vec<Arc<dyn PhysicalExtensionCodec>>,
}

impl PhysicalExtensionCodec for ComposedPhysicalExtensionCodec {
    fn try_decode(
        &self,
        buf: &[u8],
        inputs: &[Arc<dyn ExecutionPlan>],
        ctx: &TaskContext,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        let mut last_err = None;
        for codec in &self.codecs {
            match codec.try_decode(buf, inputs, ctx) {
                Ok(plan) => return Ok(plan),
                Err(e) => last_err = Some(e),
            }
        }
        Err(last_err.unwrap())
    }

    fn try_encode(&self, node: Arc<dyn ExecutionPlan>, buf: &mut Vec<u8>) -> Result<()> {
        let mut last_err = None;
        for codec in &self.codecs {
            match codec.try_encode(node.clone(), buf) {
                Ok(_) => return Ok(()),
                Err(e) => last_err = Some(e),
            }
        }
        Err(last_err.unwrap())
    }

    fn try_decode_udf(&self, name: &str, buf: &[u8]) -> Result<Arc<ScalarUDF>> {
        let mut last_err = None;
        for codec in &self.codecs {
            match codec.try_decode_udf(name, buf) {
                Ok(plan) => return Ok(plan),
                Err(e) => last_err = Some(e),
            }
        }
        Err(last_err.unwrap())
    }

    fn try_encode_udf(&self, _node: &ScalarUDF, buf: &mut Vec<u8>) -> Result<()> {
        let mut last_err = None;
        for codec in &self.codecs {
            match codec.try_encode_udf(_node, buf) {
                Ok(_) => return Ok(()),
                Err(e) => last_err = Some(e),
            }
        }
        Err(last_err.unwrap())
    }
}
