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

use ::datafusion::{physical_plan::ExecutionPlan, prelude::SessionContext};
use arrow_schema::Schema;
use config::{
    get_config,
    meta::{inverted_index::IndexOptimizeMode, stream::StreamType},
};
use datafusion::physical_optimizer::PhysicalOptimizerRule;
use hashbrown::HashSet;
use infra::errors::Error;
use parking_lot::Mutex;

use crate::{
    datafusion::optimizer::physical_optimizer::{
        index::IndexRule, index_optimizer::FollowerIndexOptimizerRule,
        rewrite_match::RewriteMatchPhysical,
    },
    index::IndexCondition,
};

/// What the tantivy index does for this query, as decided by the physical optimizer rules.
pub(super) struct IndexPlan {
    pub(super) condition: Option<IndexCondition>,
    pub(super) mode: Option<IndexOptimizeMode>,
}

impl IndexPlan {
    pub(super) fn use_inverted_index(&self) -> bool {
        self.condition.as_ref().is_some_and(|condition| {
            get_config().search.inverted_index_enabled
                && (!condition.is_condition_all() || self.mode.is_some())
        })
    }

    pub(super) fn use_metadata_count(&self) -> bool {
        matches!(self.mode, Some(IndexOptimizeMode::SimpleCount))
            && self
                .condition
                .as_ref()
                .is_some_and(IndexCondition::is_condition_all)
    }

    pub(super) fn aggregate_mode(&self) -> Option<&IndexOptimizeMode> {
        self.mode.as_ref().filter(|mode| mode.is_aggregate())
    }

    /// Mode handed to the storage scan; aggregate modes are answered before the scan.
    pub(super) fn storage_mode(&self) -> Option<IndexOptimizeMode> {
        self.mode.clone().filter(|mode| !mode.is_aggregate())
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn optimizer_physical_plan(
    plan: Arc<dyn ExecutionPlan>,
    ctx: &SessionContext,
    schema: &Schema,
    stream_type: StreamType,
    time_range: (i64, i64),
    fst_fields: Vec<String>,
    index_fields: Vec<String>,
    requested_mode: Option<IndexOptimizeMode>,
) -> Result<(Arc<dyn ExecutionPlan>, IndexPlan), Error> {
    let index_condition_ref = Arc::new(Mutex::new(None));
    let index_optimizer_rule_ref = Arc::new(Mutex::new(requested_mode));
    let index_fields: HashSet<String> = index_fields.iter().cloned().collect();
    let index_rule = IndexRule::new(index_fields.clone(), index_condition_ref.clone());
    let original_plan = Arc::clone(&plan);
    let plan = index_rule.optimize(plan, ctx.state().config_options())?;

    // if the index rule can't optimize, we should take the index optimizer rule
    if !index_rule.can_optimize() {
        index_optimizer_rule_ref.lock().take();
    }

    // if the index condition is some, and the index optimizer rule is none,
    // and filter only have _timestamp filter, we can try to optimize the plan
    if index_condition_ref.lock().is_some()
        && index_optimizer_rule_ref.lock().is_none()
        && index_rule.can_optimize()
    {
        let index_optimizer_rule = FollowerIndexOptimizerRule::new(
            time_range,
            index_fields.clone(),
            index_optimizer_rule_ref.clone(),
        );
        let _ = index_optimizer_rule.optimize(original_plan, ctx.state().config_options())?;
    }

    {
        let mut index_optimizer_rule = index_optimizer_rule_ref.lock();
        *index_optimizer_rule =
            index_optimize_mode_for_stream(stream_type, index_optimizer_rule.take());
    }

    let rewrite_match_rule = RewriteMatchPhysical::new(
        fst_fields
            .clone()
            .into_iter()
            .map(|f| {
                (
                    f.clone(),
                    schema.field_with_name(&f).unwrap().data_type().clone(),
                )
            })
            .collect(),
    );
    let plan = rewrite_match_rule.optimize(plan, ctx.state().config_options())?;

    // reset the index_condition if index_optimizer_rule is none and index_condition is all
    let index_condition = index_condition_ref.lock().clone();
    if index_condition.is_some()
        && index_condition.as_ref().unwrap().is_condition_all()
        && index_optimizer_rule_ref.lock().is_none()
    {
        index_condition_ref.lock().take();
    }

    let index = IndexPlan {
        condition: index_condition_ref.lock().take(),
        mode: index_optimizer_rule_ref.lock().take(),
    };
    Ok((plan, index))
}

fn index_optimize_mode_for_stream(
    stream_type: StreamType,
    mode: Option<IndexOptimizeMode>,
) -> Option<IndexOptimizeMode> {
    // Metrics files may be hash-ordered, so Tantivy doc IDs do not guarantee timestamp order.
    if stream_type == StreamType::Metrics
        && matches!(mode, Some(IndexOptimizeMode::SimpleSelect(..)))
    {
        None
    } else {
        mode
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema};
    use datafusion::{
        execution::{SessionStateBuilder, runtime_env::RuntimeEnvBuilder},
        prelude::SessionConfig,
    };

    use super::*;
    use crate::{
        datafusion::{
            optimizer::logical_optimizer::rewrite_histogram::RewriteHistogram,
            table_provider::empty_table::NewEmptyTable, udf::histogram_udf,
        },
        index::Condition,
    };

    #[tokio::test]
    async fn test_optimizer_physical_plan_detects_histogram_with_index_filter() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("kubernetes_namespace_name", DataType::Utf8, false),
        ]));
        let start_time = 1757401694060000;
        let end_time = 1757402594060000;
        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_default_features()
            .with_optimizer_rule(Arc::new(RewriteHistogram::new(
                start_time, end_time, 60, None,
            )))
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("default", schema.clone());
        ctx.register_table("default", Arc::new(provider)).unwrap();
        ctx.register_udf(histogram_udf::HISTOGRAM_UDF.clone());

        let logical_plan = ctx
            .state()
            .create_logical_plan(
                "SELECT histogram(_timestamp) as ts, count(*) as cnt \
                 FROM default \
                 WHERE kubernetes_namespace_name = 'ziox' \
                 GROUP BY ts ORDER BY ts",
            )
            .await
            .unwrap();
        let physical_plan = ctx
            .state()
            .create_physical_plan(&logical_plan)
            .await
            .unwrap();
        let (_plan, index) = optimizer_physical_plan(
            physical_plan,
            &ctx,
            &schema,
            StreamType::Logs,
            (start_time, end_time),
            vec![],
            vec!["kubernetes_namespace_name".to_string()],
            None,
        )
        .unwrap();

        assert_eq!(
            index.condition,
            Some(IndexCondition {
                conditions: vec![Condition::Equal(
                    "kubernetes_namespace_name".to_string(),
                    "ziox".to_string(),
                )],
            })
        );
        assert!(matches!(
            index.mode,
            Some(IndexOptimizeMode::SimpleHistogram(..))
        ));
    }

    #[test]
    fn test_index_optimize_mode_for_stream_disables_metrics_simple_select() {
        let simple_select = Some(IndexOptimizeMode::SimpleSelect(10, false));

        assert_eq!(
            index_optimize_mode_for_stream(StreamType::Metrics, simple_select.clone()),
            None
        );
        assert_eq!(
            index_optimize_mode_for_stream(StreamType::Logs, simple_select.clone()),
            simple_select
        );
        assert_eq!(
            index_optimize_mode_for_stream(
                StreamType::Metrics,
                Some(IndexOptimizeMode::SimpleCount),
            ),
            Some(IndexOptimizeMode::SimpleCount)
        );
    }

    #[tokio::test]
    async fn test_optimizer_physical_plan_disables_detected_metrics_simple_select() {
        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("name", DataType::Utf8, false),
        ]));
        let state = SessionStateBuilder::new()
            .with_config(SessionConfig::new().with_target_partitions(12))
            .with_runtime_env(Arc::new(RuntimeEnvBuilder::new().build().unwrap()))
            .with_default_features()
            .build();
        let ctx = SessionContext::new_with_state(state);
        let provider = NewEmptyTable::new("default", schema.clone()).with_partitions(12);
        ctx.register_table("default", Arc::new(provider)).unwrap();

        let logical_plan = ctx
            .state()
            .create_logical_plan("SELECT * FROM default ORDER BY _timestamp DESC LIMIT 10")
            .await
            .unwrap();
        let physical_plan = ctx
            .state()
            .create_physical_plan(&logical_plan)
            .await
            .unwrap();

        for (stream_type, expected_mode) in [
            (
                StreamType::Logs,
                Some(IndexOptimizeMode::SimpleSelect(10, false)),
            ),
            (StreamType::Metrics, None),
        ] {
            let is_metrics = stream_type == StreamType::Metrics;

            let (_plan, index) = optimizer_physical_plan(
                physical_plan.clone(),
                &ctx,
                &schema,
                stream_type,
                (0, 100),
                vec![],
                vec![],
                None,
            )
            .unwrap();

            assert_eq!(index.mode, expected_mode);
            assert_eq!(index.condition.is_none(), is_metrics);
        }
    }

    #[test]
    fn test_use_metadata_count_only_for_unfiltered_simple_count() {
        let condition = |condition: Condition| {
            let mut index_condition = IndexCondition::new();
            index_condition.add_condition(condition);
            Some(index_condition)
        };
        let plan = |condition, mode| IndexPlan { condition, mode };

        assert!(
            plan(
                condition(Condition::All()),
                Some(IndexOptimizeMode::SimpleCount)
            )
            .use_metadata_count()
        );
        assert!(
            !plan(
                condition(Condition::Equal("service".into(), "a".into())),
                Some(IndexOptimizeMode::SimpleCount),
            )
            .use_metadata_count()
        );
        assert!(
            !plan(
                condition(Condition::All()),
                Some(IndexOptimizeMode::SimpleHistogram(0, 1, 1, 0)),
            )
            .use_metadata_count()
        );
        assert!(!plan(None, Some(IndexOptimizeMode::SimpleCount)).use_metadata_count());
    }
}
