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

//! Scan-level search-time redaction: the scan output is redacted before any operator reads it.

use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

#[cfg(feature = "vectorscan")]
use config::meta::{search::RawStreams, sql::TableReferenceExt, stream::StreamType};
use config::{ALL_VALUES_COL_NAME, ORIGINAL_DATA_COL_NAME, meta::search::SDR_REDACT_UDF_NAME};
#[cfg(feature = "vectorscan")]
use datafusion::common::TableReference;
use datafusion::{
    common::{
        Result, ScalarValue,
        config::ConfigOptions,
        tree_node::{Transformed, TreeNode},
    },
    logical_expr::{Expr, ScalarUDF},
    physical_expr::{
        PhysicalExpr, ScalarFunctionExpr,
        expressions::{Column, Literal},
        utils::collect_columns,
    },
    physical_optimizer::PhysicalOptimizerRule,
    physical_plan::{
        ChildrenPropertiesMode, ExecutionPlan, Partitioning, ReplaceChildrenOptions,
        coalesce_partitions::CoalescePartitionsExec,
        filter::FilterExec,
        limit::{GlobalLimitExec, LocalLimitExec},
        projection::{ProjectionExec, ProjectionExpr},
        repartition::RepartitionExec,
        sorts::{sort::SortExec, sort_preserving_merge::SortPreservingMergeExec},
    },
};
#[cfg(feature = "vectorscan")]
use o2_enterprise::enterprise::re_patterns::PATTERN_MANAGER;

use crate::datafusion::udf::fulltext::match_all::{FUZZY_MATCH_ALL_UDF_NAME, MATCH_ALL_UDF_NAME};

/// Columns that copy raw data wholesale, so on a protected stream they are never returned.
pub const RAW_COPY_COLUMNS: [&str; 2] = [ORIGINAL_DATA_COL_NAME, ALL_VALUES_COL_NAME];

/// Moves the redact projection above row-wise operators that read no redacted column, so
/// only the rows they keep are redacted. It never passes an aggregate, join or window.
#[derive(Debug, Default)]
pub struct LiftRedaction;

impl PhysicalOptimizerRule for LiftRedaction {
    fn optimize(
        &self,
        plan: Arc<dyn ExecutionPlan>,
        _config: &ConfigOptions,
    ) -> Result<Arc<dyn ExecutionPlan>> {
        plan.transform_up(lift_once).map(|t| t.data)
    }

    fn name(&self) -> &str {
        "LiftRedaction"
    }

    fn schema_check(&self) -> bool {
        true
    }
}

/// Columns of a stream whose index terms or values hold raw protected data; empty when the
/// stream is unprotected or the pattern manager is not ready, which the scanning node rechecks.
#[cfg(feature = "vectorscan")]
pub fn protected_columns(
    org_id: &str,
    stream_type: StreamType,
    stream_name: &str,
) -> HashSet<String> {
    let Some(manager) = PATTERN_MANAGER.get() else {
        return HashSet::new();
    };
    match manager.search_protection(org_id, stream_type, stream_name) {
        Ok(Some(protection)) => protection
            .fields
            .into_iter()
            .chain(RAW_COPY_COLUMNS.iter().map(|c| c.to_string()))
            .collect(),
        _ => HashSet::new(),
    }
}

/// Part of a cache key: results are stored redacted, so a pattern change must miss them. `None`
/// when no stream read is redacted; a raw stream reads like an unprotected one and shares its key.
#[cfg(feature = "vectorscan")]
pub fn redaction_digest(
    org_id: &str,
    stream_type: StreamType,
    streams: &[TableReference],
    raw_streams: Option<&RawStreams>,
) -> Option<String> {
    let Some(manager) = PATTERN_MANAGER.get() else {
        return Some("sdr=unavailable".to_string());
    };
    let parts: Vec<String> = streams
        .iter()
        .filter_map(|stream| {
            let stype = stream.get_stream_type(stream_type);
            let name = stream.stream_name();
            if raw_streams.is_some_and(|raw| raw.contains(stype, &name)) {
                return None;
            }
            match manager.search_protection(org_id, stype, &name) {
                Ok(Some(protection)) => Some(format!("{stype}/{name}={}", protection.digest)),
                Ok(None) => None,
                Err(_) => Some(format!("{stype}/{name}=unbuilt")),
            }
        })
        .collect();
    (!parts.is_empty()).then(|| format!("sdr={}", parts.join(";")))
}

/// Filters the scan may evaluate: one reading a redacted column would run on the raw value,
/// and `match_all` reads the FTS fields without naming them.
pub fn scan_filters(filters: &[Expr], redacted: &HashSet<String>) -> Vec<Expr> {
    if redacted.is_empty() {
        return filters.to_vec();
    }
    filters
        .iter()
        .filter(|expr| {
            let reads_redacted = expr
                .column_refs()
                .iter()
                .any(|col| redacted.contains(col.name.as_str()));
            let reads_fts = expr
                .exists(|e| {
                    Ok(matches!(e, Expr::ScalarFunction(f)
                        if [MATCH_ALL_UDF_NAME, FUZZY_MATCH_ALL_UDF_NAME].contains(&f.name())))
                })
                .unwrap_or(true);
            !reads_redacted && !reads_fts
        })
        .cloned()
        .collect()
}

/// The names a redact projection over `schema` rewrites: the protected fields plus the raw copies.
pub fn redacted_columns(protected: &HashMap<String, Arc<ScalarUDF>>) -> HashSet<String> {
    protected
        .keys()
        .cloned()
        .chain(RAW_COPY_COLUMNS.iter().map(|c| c.to_string()))
        .collect()
}

/// Wraps `scan` so each protected column goes through its redact function and the raw-copy
/// columns are NULL; returns `scan` unchanged when it outputs none of them.
pub fn wrap_with_redaction(
    scan: Arc<dyn ExecutionPlan>,
    protected: &HashMap<String, Arc<ScalarUDF>>,
    config_options: Arc<ConfigOptions>,
) -> Result<Arc<dyn ExecutionPlan>> {
    let schema = scan.schema();
    let mut changed = false;
    let mut exprs = Vec::with_capacity(schema.fields().len());
    for (idx, field) in schema.fields().iter().enumerate() {
        let column: Arc<dyn PhysicalExpr> = Arc::new(Column::new(field.name(), idx));
        let expr: Arc<dyn PhysicalExpr> = if let Some(udf) = protected.get(field.name()) {
            changed = true;
            Arc::new(ScalarFunctionExpr::try_new(
                udf.clone(),
                vec![column],
                &schema,
                config_options.clone(),
            )?)
        } else if RAW_COPY_COLUMNS.contains(&field.name().as_str()) {
            changed = true;
            Arc::new(Literal::new(ScalarValue::try_from(field.data_type())?))
        } else {
            column
        };
        exprs.push(ProjectionExpr {
            expr,
            alias: field.name().to_string(),
        });
    }
    if !changed {
        return Ok(scan);
    }
    Ok(Arc::new(ProjectionExec::try_new(exprs, scan)?))
}

/// The output indexes a redact projection rewrites; `None` when `plan` is not one, so a
/// projection that reorders or computes columns is never mistaken for it.
fn redacted_indexes(plan: &Arc<dyn ExecutionPlan>) -> Option<HashSet<usize>> {
    let projection = plan.downcast_ref::<ProjectionExec>()?;
    let input_schema = projection.input().schema();
    if projection.expr().len() != input_schema.fields().len() {
        return None;
    }
    let mut redacted = HashSet::new();
    for (idx, pe) in projection.expr().iter().enumerate() {
        if pe.alias != *input_schema.field(idx).name() {
            return None;
        }
        if let Some(col) = pe.expr.downcast_ref::<Column>() {
            if col.index() != idx {
                return None;
            }
        } else if is_redact_expr(&pe.expr, idx) {
            redacted.insert(idx);
        } else {
            return None;
        }
    }
    (!redacted.is_empty()).then_some(redacted)
}

fn is_redact_expr(expr: &Arc<dyn PhysicalExpr>, idx: usize) -> bool {
    if let Some(func) = expr.downcast_ref::<ScalarFunctionExpr>() {
        return func.name() == SDR_REDACT_UDF_NAME
            && func.args().len() == 1
            && func.args()[0]
                .downcast_ref::<Column>()
                .is_some_and(|c| c.index() == idx);
    }
    expr.downcast_ref::<Literal>()
        .is_some_and(|lit| lit.value().is_null())
}

fn reads_any(exprs: impl IntoIterator<Item = Arc<dyn PhysicalExpr>>, set: &HashSet<usize>) -> bool {
    exprs.into_iter().any(|expr| {
        collect_columns(&expr)
            .iter()
            .any(|c| set.contains(&c.index()))
    })
}

/// True when `node` only selects, orders or moves rows and reads no column in `redacted`.
fn can_lift_over(node: &Arc<dyn ExecutionPlan>, redacted: &HashSet<usize>) -> bool {
    if let Some(filter) = node.downcast_ref::<FilterExec>() {
        return filter.projection().is_none() && !reads_any([filter.predicate().clone()], redacted);
    }
    if let Some(sort) = node.downcast_ref::<SortExec>() {
        return !reads_any(sort.expr().iter().map(|s| s.expr.clone()), redacted);
    }
    if let Some(merge) = node.downcast_ref::<SortPreservingMergeExec>() {
        return !reads_any(merge.expr().iter().map(|s| s.expr.clone()), redacted);
    }
    if let Some(repartition) = node.downcast_ref::<RepartitionExec>() {
        return match repartition.partitioning() {
            Partitioning::Hash(exprs, _) => !reads_any(exprs.iter().cloned(), redacted),
            _ => true,
        };
    }
    node.downcast_ref::<GlobalLimitExec>().is_some()
        || node.downcast_ref::<LocalLimitExec>().is_some()
        || node.downcast_ref::<CoalescePartitionsExec>().is_some()
}

/// The redact projection keeps the schema of its input, so the operator moved below it keeps
/// its column indexes unchanged.
fn lift_once(node: Arc<dyn ExecutionPlan>) -> Result<Transformed<Arc<dyn ExecutionPlan>>> {
    let children = node.children();
    if children.len() != 1 {
        return Ok(Transformed::no(node));
    }
    let child = children[0].clone();
    let Some(redacted) = redacted_indexes(&child) else {
        return Ok(Transformed::no(node));
    };
    if !can_lift_over(&node, &redacted) {
        return Ok(Transformed::no(node));
    }
    let projection_input = child.children()[0].clone();
    let options = ReplaceChildrenOptions::new(ChildrenPropertiesMode::Recompute);
    let lowered = node.replace_children(vec![projection_input], options)?;
    let lifted = child.replace_children(vec![lowered], options)?;
    Ok(Transformed::yes(lifted))
}

#[cfg(test)]
mod tests {
    use async_trait::async_trait;
    use datafusion::{
        arrow::{
            array::{ArrayRef, Int64Array, RecordBatch, StringArray},
            datatypes::{DataType, Field, Schema, SchemaRef},
            util::pretty::pretty_format_batches,
        },
        catalog::Session,
        common::cast::as_string_array,
        datasource::{MemTable, TableProvider, TableType},
        logical_expr::{
            ColumnarValue, TableProviderFilterPushDown, Volatility, create_udf,
            expr::ScalarFunction,
        },
        physical_plan::displayable,
        prelude::SessionContext,
    };

    use super::*;

    const SECRET_ROWS: [&str; 3] = [
        "login user SECRETVAL10000 ok",
        "login user SECRETVAL10001 ok",
        "nothing to hide",
    ];

    /// Stands in for the enterprise function: the same name and the same per-value rewrite.
    fn test_redact_udf() -> Arc<ScalarUDF> {
        let pattern = regex::Regex::new(r"SECRETVAL\d+").unwrap();
        Arc::new(create_udf(
            SDR_REDACT_UDF_NAME,
            vec![DataType::Utf8],
            DataType::Utf8,
            Volatility::Immutable,
            Arc::new(move |args: &[ColumnarValue]| {
                let arrays = ColumnarValue::values_to_arrays(args)?;
                let strings = as_string_array(&arrays[0])?;
                let out: StringArray = strings
                    .iter()
                    .map(|v| v.map(|v| pattern.replace_all(v, "[REDACTED]").into_owned()))
                    .collect();
                Ok(ColumnarValue::Array(Arc::new(out) as ArrayRef))
            }),
        ))
    }

    fn protected() -> HashMap<String, Arc<ScalarUDF>> {
        HashMap::from([("msg".to_string(), test_redact_udf())])
    }

    fn test_schema() -> SchemaRef {
        Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("msg", DataType::Utf8, true),
            Field::new("level", DataType::Utf8, true),
            Field::new(ORIGINAL_DATA_COL_NAME, DataType::Utf8, true),
        ]))
    }

    fn test_batch() -> RecordBatch {
        RecordBatch::try_new(
            test_schema(),
            vec![
                Arc::new(Int64Array::from(vec![1, 2, 3])),
                Arc::new(StringArray::from(SECRET_ROWS.to_vec())),
                Arc::new(StringArray::from(vec!["info", "error", "info"])),
                Arc::new(StringArray::from(
                    SECRET_ROWS
                        .iter()
                        .map(|m| format!("{{\"msg\":\"{m}\"}}"))
                        .collect::<Vec<_>>(),
                )),
            ],
        )
        .unwrap()
    }

    /// Scans like the scanning node: filters on redacted columns stay out of the scan.
    #[derive(Debug)]
    struct RedactedTable {
        inner: MemTable,
        protected: HashMap<String, Arc<ScalarUDF>>,
    }

    #[async_trait]
    impl TableProvider for RedactedTable {
        fn schema(&self) -> SchemaRef {
            self.inner.schema()
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
            let filters = scan_filters(filters, &redacted_columns(&self.protected));
            let scan = self.inner.scan(state, projection, &filters, limit).await?;
            let options = Arc::new(state.config_options().clone());
            wrap_with_redaction(scan, &self.protected, options)
        }

        fn supports_filters_pushdown(
            &self,
            filters: &[&Expr],
        ) -> Result<Vec<TableProviderFilterPushDown>> {
            Ok(vec![TableProviderFilterPushDown::Inexact; filters.len()])
        }
    }

    fn redacted_ctx() -> SessionContext {
        let ctx = SessionContext::new();
        let inner = MemTable::try_new(test_schema(), vec![vec![test_batch()]]).unwrap();
        let table = RedactedTable {
            inner,
            protected: protected(),
        };
        ctx.register_table("t", Arc::new(table)).unwrap();
        ctx
    }

    async fn run(ctx: &SessionContext, sql: &str) -> String {
        let batches = ctx.sql(sql).await.unwrap().collect().await.unwrap();
        pretty_format_batches(&batches).unwrap().to_string()
    }

    fn leaks(output: &str) -> bool {
        let upper = output.to_uppercase();
        ["SECRETVAL", "LAVTERCES", "10000", "00001", "10001", "10001"]
            .iter()
            .any(|needle| upper.contains(needle))
    }

    // Each shape here returned the raw value while redaction ran on the response.
    #[tokio::test]
    async fn test_no_query_shape_returns_a_raw_value() {
        let ctx = redacted_ctx();
        let battery = [
            "SELECT msg FROM t",
            "SELECT msg AS m FROM t",
            "SELECT CAST(msg AS VARCHAR) AS m FROM t",
            "SELECT lower(msg) FROM t",
            "SELECT upper(msg) FROM t",
            "SELECT reverse(msg) FROM t",
            "SELECT replace(msg, 'login user ', '') FROM t",
            "SELECT regexp_replace(msg, '^login user ', '') FROM t",
            "SELECT substr(msg, 12, 14) FROM t",
            "SELECT concat(substr(msg, 1, 15), substr(msg, 16)) FROM t",
            "SELECT array_agg(msg) FROM t",
            "SELECT string_agg(msg, ',') FROM t",
            "SELECT msg, count(*) FROM t GROUP BY msg",
            "SELECT DISTINCT msg FROM t",
            "SELECT m FROM (SELECT lower(msg) AS m FROM t) sub",
            "WITH c AS (SELECT msg FROM t) SELECT upper(msg) FROM c",
            "SELECT msg FROM t UNION ALL SELECT reverse(msg) FROM t",
            "SELECT a.msg FROM t a JOIN t b ON a.msg = b.msg",
            "SELECT msg FROM t WHERE level = 'error' ORDER BY _timestamp DESC LIMIT 1",
            "SELECT _original FROM t",
            "SELECT msg FROM t WHERE msg LIKE '%SECRETVAL1%'",
        ];
        for sql in battery {
            let output = run(&ctx, sql).await;
            assert!(!leaks(&output), "{sql} leaked:\n{output}");
        }
    }

    #[tokio::test]
    async fn test_encoded_output_holds_only_the_redacted_text() {
        let ctx = redacted_ctx();
        let batches = ctx
            .sql("SELECT encode(msg, 'base64') AS m FROM t ORDER BY _timestamp")
            .await
            .unwrap()
            .collect()
            .await
            .unwrap();
        let encoded = as_string_array(batches[0].column(0)).unwrap();
        let decoded = config::utils::base64::decode(encoded.value(0)).unwrap();
        assert_eq!(decoded, "login user [REDACTED] ok");
    }

    // A filter that is always true on the redacted value must not select rows by the raw one.
    #[tokio::test]
    async fn test_filters_see_only_redacted_values() {
        let ctx = redacted_ctx();
        let count = |guess: &'static str| {
            let ctx = &ctx;
            async move {
                run(
                    ctx,
                    &format!(
                        "SELECT count(*) AS c FROM t WHERE msg LIKE '{guess}' OR msg LIKE '%[REDACTED]%'"
                    ),
                )
                .await
            }
        };
        assert_eq!(count("%SECRETVAL10000%").await, count("%NOPE%").await);
        let none = run(
            &ctx,
            "SELECT count(*) AS c FROM t WHERE msg LIKE '%SECRETVAL%'",
        )
        .await;
        assert!(none.contains("| 0 "), "{none}");
    }

    #[test]
    fn test_scan_filters_drop_redacted_and_match_all() {
        use datafusion::logical_expr::{col, lit};

        let redacted = redacted_columns(&protected());
        let match_all = Expr::ScalarFunction(ScalarFunction::new_udf(
            Arc::new(create_udf(
                MATCH_ALL_UDF_NAME,
                vec![DataType::Utf8],
                DataType::Boolean,
                Volatility::Immutable,
                Arc::new(|_: &[ColumnarValue]| unreachable!()),
            )),
            vec![lit("x")],
        ));
        let filters = vec![
            col("level").eq(lit("info")),
            col("msg").like(lit("%a%")),
            col(ORIGINAL_DATA_COL_NAME).like(lit("%a%")),
            match_all,
        ];
        assert_eq!(scan_filters(&filters, &redacted), vec![filters[0].clone()]);
        assert_eq!(scan_filters(&filters, &HashSet::new()), filters);
    }

    #[test]
    fn test_wrap_keeps_the_schema_and_skips_a_scan_without_redacted_columns() {
        use datafusion::datasource::memory::MemorySourceConfig;

        let options = Arc::new(ConfigOptions::default());
        let scan: Arc<dyn ExecutionPlan> =
            MemorySourceConfig::try_new_exec(&[vec![test_batch()]], test_schema(), None).unwrap();
        let wrapped = wrap_with_redaction(scan.clone(), &protected(), options.clone()).unwrap();
        let names = |plan: &Arc<dyn ExecutionPlan>| {
            plan.schema()
                .fields()
                .iter()
                .map(|f| (f.name().clone(), f.data_type().clone()))
                .collect::<Vec<_>>()
        };
        assert_eq!(names(&wrapped), names(&scan));
        assert!(redacted_indexes(&wrapped).is_some());

        let level_only: Arc<dyn ExecutionPlan> = MemorySourceConfig::try_new_exec(
            &[vec![test_batch()]],
            test_schema(),
            Some(vec![0, 2]),
        )
        .unwrap();
        let unchanged = wrap_with_redaction(level_only.clone(), &protected(), options).unwrap();
        assert!(Arc::ptr_eq(&unchanged, &level_only));
    }

    async fn optimized_plan(sql: &str) -> String {
        let ctx = redacted_ctx();
        let plan = ctx
            .sql(sql)
            .await
            .unwrap()
            .create_physical_plan()
            .await
            .unwrap();
        let lifted = LiftRedaction
            .optimize(plan, &ConfigOptions::default())
            .unwrap();
        displayable(lifted.as_ref()).indent(false).to_string()
    }

    fn line_of(plan: &str, needle: &str) -> usize {
        plan.lines()
            .position(|l| l.contains(needle))
            .unwrap_or_else(|| panic!("{needle} not in\n{plan}"))
    }

    #[tokio::test]
    async fn test_lift_moves_redaction_above_row_operators_on_other_columns() {
        let plan = optimized_plan(
            "SELECT * FROM t WHERE level = 'error' ORDER BY _timestamp DESC LIMIT 1",
        )
        .await;
        let redact = line_of(&plan, SDR_REDACT_UDF_NAME);
        assert!(redact < line_of(&plan, "SortExec"), "{plan}");
        assert!(redact < line_of(&plan, "FilterExec"), "{plan}");
    }

    #[tokio::test]
    async fn test_lift_stops_below_operators_reading_a_redacted_column() {
        let plan = optimized_plan("SELECT * FROM t WHERE msg LIKE '%a%'").await;
        assert!(
            line_of(&plan, SDR_REDACT_UDF_NAME) > line_of(&plan, "FilterExec"),
            "{plan}"
        );
        let plan = optimized_plan("SELECT * FROM t ORDER BY msg LIMIT 1").await;
        assert!(
            line_of(&plan, SDR_REDACT_UDF_NAME) > line_of(&plan, "SortExec"),
            "{plan}"
        );
        let plan = optimized_plan("SELECT level, max(msg) FROM t GROUP BY level").await;
        assert!(
            line_of(&plan, SDR_REDACT_UDF_NAME) > line_of(&plan, "AggregateExec"),
            "{plan}"
        );
    }

    #[cfg(feature = "vectorscan")]
    #[test]
    fn test_digest_separates_raw_and_redacted_readers() {
        use config::meta::{search::RawStreams, stream::StreamType};
        use o2_enterprise::enterprise::re_patterns::{PATTERN_MANAGER, PatternManager};

        if PATTERN_MANAGER.get().is_none() {
            let _ = PATTERN_MANAGER.set(PatternManager::empty());
        }
        let mgr = PATTERN_MANAGER.get().unwrap();
        mgr.insert_pattern(infra::table::re_pattern::PatternEntry {
            id: "digest_secret".to_string(),
            org: "sdr_digest".to_string(),
            name: "digest_secret".to_string(),
            description: String::new(),
            created_by: String::new(),
            created_at: 0,
            updated_at: 0,
            pattern: r"SECRETVAL\d+".to_string(),
        });
        mgr.update_associations(
            "sdr_digest",
            StreamType::Logs,
            "app",
            vec![],
            vec![config::meta::stream::PatternAssociation {
                field: "msg".to_string(),
                pattern_id: "digest_secret".to_string(),
                policy: "Redact".to_string(),
                apply_at: "AtSearch".to_string(),
                ..Default::default()
            }],
        )
        .unwrap();

        let streams = [datafusion::common::TableReference::from("app")];
        let digest = |raw: Option<&RawStreams>| {
            redaction_digest("sdr_digest", StreamType::Logs, &streams, raw)
        };
        let mut raw = RawStreams::default();
        raw.insert(StreamType::Logs, "app");
        let redacted = digest(Some(&RawStreams::default()));
        assert!(redacted.is_some());
        assert_eq!(digest(None), redacted);

        let unprotected = [datafusion::common::TableReference::from("plain")];
        let plain = redaction_digest("sdr_digest", StreamType::Logs, &unprotected, None);
        assert_eq!(plain, None);
        assert_eq!(digest(Some(&raw)), plain);
    }
}
