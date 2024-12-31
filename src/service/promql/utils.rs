// Copyright 2024 OpenObserve Inc.
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

use std::{collections::HashSet, sync::Arc};

use arrow::record_batch::RecordBatch;
use config::{
    get_config,
    meta::{cluster::IntoArcVec, search::ScanStats, stream::StreamType},
    utils::record_batch_ext::RecordBatchExt,
};
use datafusion::{
    arrow::datatypes::Schema,
    datasource::MemTable,
    error::{DataFusionError, Result},
    physical_plan::visit_execution_plan,
    prelude::{col, lit, DataFrame, SessionContext},
};
use promql_parser::label::{MatchOp, Matchers};
use proto::cluster_rpc::{self, IndexInfo, QueryIdentifier};
use tracing_opentelemetry::OpenTelemetrySpanExt;

use crate::{
    common::{
        infra::cluster::get_cached_online_ingester_nodes,
        meta::prom::{BUCKET_LABEL, HASH_LABEL, VALUE_LABEL},
    },
    service::search::{
        cluster::flight::print_plan,
        datafusion::{
            distributed_plan::{
                node::{RemoteScanNode, SearchInfos},
                remote_scan::RemoteScanExec,
            },
            exec::prepare_datafusion_context,
            table_provider::empty_table::NewEmptyTable,
        },
        grpc::wal::adapt_batch,
        utils::ScanStatsVisitor,
    },
};

pub fn apply_matchers(
    df: DataFrame,
    schema: Arc<Schema>,
    matchers: &Matchers,
) -> Result<DataFrame> {
    let cfg = get_config();
    let mut df = df;
    for mat in matchers.matchers.iter() {
        if mat.name == cfg.common.column_timestamp
            || mat.name == VALUE_LABEL
            || schema.field_with_name(&mat.name).is_err()
        {
            continue;
        }
        match &mat.op {
            MatchOp::Equal => df = df.filter(col(mat.name.clone()).eq(lit(mat.value.clone())))?,
            MatchOp::NotEqual => {
                df = df.filter(col(mat.name.clone()).not_eq(lit(mat.value.clone())))?
            }
            MatchOp::Re(regex) => {
                let regexp_match_udf =
                    crate::service::search::datafusion::udf::regexp_udf::REGEX_MATCH_UDF.clone();
                df = df.filter(
                    regexp_match_udf.call(vec![col(mat.name.clone()), lit(regex.as_str())]),
                )?
            }
            MatchOp::NotRe(regex) => {
                let regexp_not_match_udf =
                    crate::service::search::datafusion::udf::regexp_udf::REGEX_NOT_MATCH_UDF
                        .clone();
                df = df.filter(
                    regexp_not_match_udf.call(vec![col(mat.name.clone()), lit(regex.as_str())]),
                )?
            }
        }
    }
    Ok(df)
}
