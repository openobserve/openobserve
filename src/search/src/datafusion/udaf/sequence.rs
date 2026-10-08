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

use std::sync::{Arc, OnceLock};

use arrow::{
    array::{Array, ArrayRef, AsArray, BooleanArray, Int64Array, RecordBatch},
    datatypes::{FieldRef, Int64Type},
};
use datafusion::{
    arrow::datatypes::{DataType, Field, Schema},
    common::{plan_err, utils::SingleRowListArrayBuilder},
    error::Result,
    logical_expr::{
        Accumulator, AggregateUDFImpl, ColumnarValue, DocSection, Documentation,
        DocumentationBuilder, PartitionEvaluator, Signature, Volatility, WindowUDFImpl,
        aggregate_doc_sections::DOC_SECTION_GENERAL,
        function::{AccumulatorArgs, PartitionEvaluatorArgs, StateFieldsArgs, WindowUDFFieldArgs},
        utils::format_state_name,
        window_doc_sections::DOC_SECTION_ANALYTICAL,
    },
    physical_plan::PhysicalExpr,
    scalar::ScalarValue,
};

const DEPTH_NAME: &str = "sequence_depth";
const STEP_TIMES_NAME: &str = "sequence_step_times";
const STEP_MATCH_NAME: &str = "sequence_step_match";
const MAX_STEPS: usize = 20;
const WINDOW_DOC: &str =
    "Largest allowed time from the first step to the last, in the units of `ts`; 0 means no limit.";
const TS_DOC: &str =
    "Event time as an integer; a step must be strictly later than the step before it.";
const CONDITIONS_DOC: &str =
    "1 to 20 boolean conditions, one per step in order; a condition may repeat.";

/// Aggregate: how many leading steps of an ordered event sequence the group completes.
#[derive(Debug, PartialEq, Eq, Hash)]
pub struct SequenceDepth(Signature);

impl SequenceDepth {
    pub fn new() -> Self {
        Self(Signature::user_defined(Volatility::Immutable))
    }
}

impl Default for SequenceDepth {
    fn default() -> Self {
        Self::new()
    }
}

impl AggregateUDFImpl for SequenceDepth {
    fn name(&self) -> &str {
        DEPTH_NAME
    }

    fn signature(&self) -> &Signature {
        &self.0
    }

    fn coerce_types(&self, arg_types: &[DataType]) -> Result<Vec<DataType>> {
        aggregate_arg_types(DEPTH_NAME, arg_types)
    }

    fn return_type(&self, _arg_types: &[DataType]) -> Result<DataType> {
        Ok(DataType::Int64)
    }

    fn state_fields(&self, args: StateFieldsArgs) -> Result<Vec<FieldRef>> {
        Ok(state_fields(args.name))
    }

    fn accumulator(&self, args: AccumulatorArgs) -> Result<Box<dyn Accumulator>> {
        new_accumulator(DEPTH_NAME, &args, Output::Depth)
    }

    fn documentation(&self) -> Option<&Documentation> {
        static DOC: OnceLock<Documentation> = OnceLock::new();
        Some(DOC.get_or_init(|| {
            aggregate_doc(
                "Length of the longest prefix of the conditions that the group's events match in order: each step strictly later than the one before, and the last within `window` of the first.",
                "sequence_depth(window, ts, c1, ..., cN)",
            )
        }))
    }
}

/// Aggregate: per step, the least time from a sequence's first step to that step.
#[derive(Debug, PartialEq, Eq, Hash)]
pub struct SequenceStepTimes(Signature);

impl SequenceStepTimes {
    pub fn new() -> Self {
        Self(Signature::user_defined(Volatility::Immutable))
    }
}

impl Default for SequenceStepTimes {
    fn default() -> Self {
        Self::new()
    }
}

impl AggregateUDFImpl for SequenceStepTimes {
    fn name(&self) -> &str {
        STEP_TIMES_NAME
    }

    fn signature(&self) -> &Signature {
        &self.0
    }

    fn coerce_types(&self, arg_types: &[DataType]) -> Result<Vec<DataType>> {
        aggregate_arg_types(STEP_TIMES_NAME, arg_types)
    }

    fn return_type(&self, _arg_types: &[DataType]) -> Result<DataType> {
        Ok(list_of_i64())
    }

    fn state_fields(&self, args: StateFieldsArgs) -> Result<Vec<FieldRef>> {
        Ok(state_fields(args.name))
    }

    fn accumulator(&self, args: AccumulatorArgs) -> Result<Box<dyn Accumulator>> {
        new_accumulator(STEP_TIMES_NAME, &args, Output::StepTimes)
    }

    fn documentation(&self) -> Option<&Documentation> {
        static DOC: OnceLock<Documentation> = OnceLock::new();
        Some(DOC.get_or_init(|| {
            aggregate_doc(
                "List with one entry per condition: the least time from the first step of a sequence matched in order (as for sequence_depth) to that step, 0 for step 1, and null for a step never reached. The non-null entries are exactly the first sequence_depth entries.",
                "sequence_step_times(window, ts, c1, ..., cN)",
            )
        }))
    }
}

/// Window function: whether each row is step k of an ordered event sequence its partition matches.
#[derive(Debug, PartialEq, Eq, Hash)]
pub struct SequenceStepMatch(Signature);

impl SequenceStepMatch {
    pub fn new() -> Self {
        Self(Signature::user_defined(Volatility::Immutable))
    }
}

impl Default for SequenceStepMatch {
    fn default() -> Self {
        Self::new()
    }
}

impl WindowUDFImpl for SequenceStepMatch {
    fn name(&self) -> &str {
        STEP_MATCH_NAME
    }

    fn signature(&self) -> &Signature {
        &self.0
    }

    fn coerce_types(&self, arg_types: &[DataType]) -> Result<Vec<DataType>> {
        if arg_types.len() < 4 {
            return plan_err!(
                "{STEP_MATCH_NAME}(window, k, ts, c1, ..., cN) needs at least one condition"
            );
        }
        let mut types = vec![DataType::Int64, DataType::Int64, DataType::Int64];
        types.extend(std::iter::repeat_n(DataType::Boolean, arg_types.len() - 3));
        Ok(types)
    }

    fn partition_evaluator(
        &self,
        args: PartitionEvaluatorArgs,
    ) -> Result<Box<dyn PartitionEvaluator>> {
        let exprs = args.input_exprs();
        let window = literal_i64(STEP_MATCH_NAME, &exprs[0], "window")?;
        let k = usize::try_from(literal_i64(STEP_MATCH_NAME, &exprs[1], "k")?).unwrap_or(0);
        let steps = exprs.len() - 3;
        if steps > MAX_STEPS || k == 0 || k > steps {
            return plan_err!(
                "{STEP_MATCH_NAME} needs 1 <= k <= conditions <= {MAX_STEPS}, got k = {k} and {steps} conditions"
            );
        }
        Ok(Box::new(StepMatchEvaluator { window, k, steps }))
    }

    fn field(&self, field_args: WindowUDFFieldArgs) -> Result<FieldRef> {
        Ok(Arc::new(Field::new(
            field_args.name(),
            DataType::Boolean,
            true,
        )))
    }

    fn documentation(&self) -> Option<&Documentation> {
        static DOC: OnceLock<Documentation> = OnceLock::new();
        Some(DOC.get_or_init(|| {
            sequence_doc(
                DOC_SECTION_ANALYTICAL,
                "True on a row that matches condition k and is step k of a sequence the partition's events match in order, as for sequence_depth. One value per row.",
                "sequence_step_match(window, k, ts, c1, ..., cN) OVER (PARTITION BY unit)",
            )
            .with_argument("window", WINDOW_DOC)
            .with_argument("k", "The step to mark, from 1 to the number of conditions.")
            .with_argument("ts", TS_DOC)
            .with_argument("c1, ..., cN", CONDITIONS_DOC)
            .build()
        }))
    }
}

// The partial state is the raw (ts, condition mask) events, so partial aggregates merge exactly.
#[derive(Debug)]
struct SequenceAccumulator {
    output: Output,
    window: i64,
    steps: usize,
    events: Vec<(i64, i64)>,
}

impl Accumulator for SequenceAccumulator {
    fn update_batch(&mut self, values: &[ArrayRef]) -> Result<()> {
        let ts = values[1].as_primitive::<Int64Type>();
        for i in 0..ts.len() {
            let mask = row_mask(&values[2..], i);
            if ts.is_valid(i) && mask != 0 {
                self.events.push((ts.value(i), mask));
            }
        }
        Ok(())
    }

    fn merge_batch(&mut self, states: &[ArrayRef]) -> Result<()> {
        let ts = states[0].as_list::<i32>();
        let mask = states[1].as_list::<i32>();
        for i in 0..ts.len() {
            if ts.is_null(i) || mask.is_null(i) {
                continue;
            }
            let t = ts.value(i);
            let m = mask.value(i);
            let t = t.as_primitive::<Int64Type>().values();
            let m = m.as_primitive::<Int64Type>().values();
            self.events.extend(t.iter().copied().zip(m.iter().copied()));
        }
        Ok(())
    }

    fn state(&mut self) -> Result<Vec<ScalarValue>> {
        let ts: Int64Array = self.events.iter().map(|e| e.0).collect();
        let mask: Int64Array = self.events.iter().map(|e| e.1).collect();
        Ok(vec![list_scalar(Arc::new(ts)), list_scalar(Arc::new(mask))])
    }

    fn evaluate(&mut self) -> Result<ScalarValue> {
        self.events.sort_unstable();
        let c = chain(&self.events, self.steps, self.window, None);
        Ok(match self.output {
            Output::Depth => ScalarValue::Int64(Some(c.depth as i64)),
            Output::StepTimes => list_scalar(Arc::new(Int64Array::from(c.elapsed[1..].to_vec()))),
        })
    }

    fn size(&self) -> usize {
        size_of_val(self) + self.events.capacity() * size_of::<(i64, i64)>()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Output {
    Depth,
    StepTimes,
}

#[derive(Debug)]
struct StepMatchEvaluator {
    window: i64,
    k: usize,
    steps: usize,
}

impl PartitionEvaluator for StepMatchEvaluator {
    fn evaluate_all(&mut self, values: &[ArrayRef], num_rows: usize) -> Result<ArrayRef> {
        let ts = values[2].as_primitive::<Int64Type>();
        let masks: Vec<i64> = (0..num_rows).map(|i| row_mask(&values[3..], i)).collect();
        let out = step_match_rows(ts, &masks, self.steps, self.window, self.k);
        Ok(Arc::new(BooleanArray::from(out)))
    }
}

#[derive(Debug)]
struct Chain {
    depth: usize,
    elapsed: Vec<Option<i64>>,
    matched: Vec<i64>,
}

impl Chain {
    fn mark(&mut self, step: usize, t: i64, elapsed: i64, collect: Option<usize>) {
        self.depth = self.depth.max(step);
        self.elapsed[step] = Some(self.elapsed[step].map_or(elapsed, |e| e.min(elapsed)));
        if collect == Some(step) && self.matched.last() != Some(&t) {
            self.matched.push(t);
        }
    }
}

fn aggregate_arg_types(name: &str, arg_types: &[DataType]) -> Result<Vec<DataType>> {
    if arg_types.len() < 3 {
        return plan_err!("{name}(window, ts, c1, ..., cN) needs at least one condition");
    }
    let mut types = vec![DataType::Int64, DataType::Int64];
    types.extend(std::iter::repeat_n(DataType::Boolean, arg_types.len() - 2));
    Ok(types)
}

fn state_fields(name: &str) -> Vec<FieldRef> {
    vec![
        Arc::new(Field::new(
            format_state_name(name, "ts"),
            list_of_i64(),
            true,
        )),
        Arc::new(Field::new(
            format_state_name(name, "mask"),
            list_of_i64(),
            true,
        )),
    ]
}

fn new_accumulator(
    name: &str,
    args: &AccumulatorArgs,
    output: Output,
) -> Result<Box<dyn Accumulator>> {
    let window = literal_i64(name, &args.exprs[0], "window")?;
    let steps = args.exprs.len() - 2;
    if steps > MAX_STEPS {
        return plan_err!("{name} takes 1 to {MAX_STEPS} conditions, got {steps}");
    }
    Ok(Box::new(SequenceAccumulator {
        output,
        window,
        steps,
        events: Vec::new(),
    }))
}

fn sequence_doc(section: DocSection, description: &str, syntax: &str) -> DocumentationBuilder {
    Documentation::builder(section, description, syntax)
}

fn aggregate_doc(description: &str, syntax: &str) -> Documentation {
    sequence_doc(DOC_SECTION_GENERAL, description, syntax)
        .with_argument("window", WINDOW_DOC)
        .with_argument("ts", TS_DOC)
        .with_argument("c1, ..., cN", CONDITIONS_DOC)
        .build()
}

fn list_of_i64() -> DataType {
    DataType::List(Arc::new(Field::new("item", DataType::Int64, true)))
}

fn list_scalar(arr: ArrayRef) -> ScalarValue {
    SingleRowListArrayBuilder::new(arr)
        .with_nullable(true)
        .build_list_scalar()
}

fn literal_i64(name: &str, expr: &Arc<dyn PhysicalExpr>, what: &str) -> Result<i64> {
    let batch = RecordBatch::new_empty(Arc::new(Schema::empty()));
    let Ok(ColumnarValue::Scalar(value)) = expr.evaluate(&batch) else {
        return plan_err!("{name} needs {what} as a literal");
    };
    match value.cast_to(&DataType::Int64)? {
        ScalarValue::Int64(Some(v)) if v >= 0 => Ok(v),
        other => plan_err!("{name} needs {what} as a non-negative integer, got {other}"),
    }
}

fn row_mask(conditions: &[ArrayRef], i: usize) -> i64 {
    let mut mask = 0i64;
    for (bit, c) in conditions.iter().enumerate() {
        let c = c.as_boolean();
        if c.is_valid(i) && c.value(i) {
            mask |= 1 << bit;
        }
    }
    mask
}

fn step_match_rows(
    ts: &Int64Array,
    masks: &[i64],
    steps: usize,
    window: i64,
    k: usize,
) -> Vec<bool> {
    let mut events: Vec<(i64, i64)> = (0..ts.len())
        .filter(|&i| ts.is_valid(i) && masks[i] != 0)
        .map(|i| (ts.value(i), masks[i]))
        .collect();
    events.sort_unstable();
    let matched = chain(&events, steps, window, Some(k)).matched;
    let bit = 1i64 << (k - 1);
    (0..ts.len())
        .map(|i| {
            ts.is_valid(i) && masks[i] & bit != 0 && matched.binary_search(&ts.value(i)).is_ok()
        })
        .collect()
}

// Same-timestamp events are judged together; a step only advances on a strictly later one.
fn chain(events: &[(i64, i64)], steps: usize, window: i64, collect: Option<usize>) -> Chain {
    let mut latest_start: Vec<Option<i64>> = vec![None; steps + 1];
    let mut c = Chain {
        depth: 0,
        elapsed: vec![None; steps + 1],
        matched: Vec::new(),
    };
    let mut pending: Vec<(usize, i64)> = Vec::new();
    let mut i = 0;
    while i < events.len() {
        let t = events[i].0;
        pending.clear();
        while i < events.len() && events[i].0 == t {
            let mask = events[i].1;
            for s in (1..=steps).filter(|s| mask & (1 << (s - 1)) != 0) {
                let start = if s == 1 { Some(t) } else { latest_start[s - 1] };
                let Some(a) = start else { continue };
                // A gap past i64::MAX is outside every finite window and still orders the steps.
                let elapsed = t.saturating_sub(a);
                if window == 0 || elapsed <= window {
                    c.mark(s, t, elapsed, collect);
                }
                pending.push((s, a));
            }
            i += 1;
        }
        for &(s, a) in &pending {
            latest_start[s] = Some(latest_start[s].map_or(a, |b| b.max(a)));
        }
    }
    c
}

#[cfg(test)]
mod tests {
    use arrow::array::StringArray;
    use datafusion::{
        datasource::MemTable,
        prelude::{SessionConfig, SessionContext},
    };

    use super::*;
    use crate::datafusion::exec::register_builtin_udfs;

    #[test]
    fn test_chain_order_and_ties() {
        // B, A, B completes A -> B; B then A does not; equal timestamps never advance.
        assert_eq!(chain(&[(1, 2), (2, 1), (3, 2)], 2, 0, None).depth, 2);
        assert_eq!(chain(&[(1, 2), (2, 1)], 2, 0, None).depth, 1);
        assert_eq!(chain(&[(5, 1), (5, 2)], 2, 0, None).depth, 1);
    }

    #[test]
    fn test_chain_window_uses_latest_start() {
        let ev = [(0, 1), (50, 1), (100, 2), (160, 4)];
        let c = chain(&ev, 3, 120, Some(2));
        assert_eq!(c.depth, 3);
        assert_eq!(c.elapsed[1], Some(0));
        assert_eq!(c.elapsed[2], Some(50));
        assert_eq!(c.elapsed[3], Some(110));
        assert_eq!(c.matched, vec![100]);
        assert_eq!(chain(&ev, 3, 100, None).depth, 2);
        assert_eq!(chain(&[(0, 1), (100, 2), (201, 4)], 3, 200, None).depth, 2);
    }

    #[test]
    fn test_repeated_conditions_need_strictly_later_events() {
        // c1 = c2 = c3: every event sets all three bits.
        let same = 0b111;
        assert_eq!(chain(&[(1, same)], 3, 0, None).depth, 1);
        assert_eq!(chain(&[(1, same), (1, same)], 3, 0, None).depth, 1);
        assert_eq!(chain(&[(1, same), (2, same)], 3, 0, None).depth, 2);
        let c = chain(&[(1, same), (2, same), (4, same)], 3, 0, Some(2));
        assert_eq!(c.depth, 3);
        assert_eq!(c.elapsed[1..], [Some(0), Some(1), Some(3)]);
        assert_eq!(c.matched, vec![2, 4]);
        assert_eq!(
            chain(&[(1, same), (2, same), (4, same)], 3, 2, None).depth,
            2
        );
    }

    #[test]
    fn test_chain_survives_timestamps_at_the_i64_extremes() {
        let ev = [(i64::MIN, 1), (0, 2), (i64::MAX, 4)];
        let open = chain(&ev, 3, 0, None);
        assert_eq!(open.depth, 3);
        assert_eq!(open.elapsed[3], Some(i64::MAX));
        assert_eq!(chain(&ev, 3, i64::MAX - 1, None).depth, 1);
        assert_eq!(chain(&ev, 3, 10, None).depth, 1);
    }

    #[test]
    fn test_step_times_are_non_null_exactly_up_to_depth() {
        let cases: [&[(i64, i64)]; 5] = [
            &[],
            &[(3, 2), (4, 4)],
            &[(1, 1), (2, 4), (3, 2)],
            &[(1, 1), (2, 2), (3, 4), (9, 8)],
            &[(1, 3), (1, 6), (2, 6), (3, 12)],
        ];
        for events in cases {
            for window in [0, 1, 5] {
                let c = chain(events, 4, window, None);
                let reached = c.elapsed[1..].iter().take_while(|e| e.is_some()).count();
                assert_eq!(reached, c.depth, "{events:?} window {window}");
                assert!(c.elapsed[1 + c.depth..].iter().all(Option::is_none));
            }
        }
    }

    #[test]
    fn test_step_match_rows_marks_only_reached_step_rows() {
        let ts = Int64Array::from(vec![Some(3), Some(1), Some(2), None, Some(4)]);
        let masks = [2, 2, 1, 2, 2];
        assert_eq!(
            step_match_rows(&ts, &masks, 2, 0, 2),
            vec![true, false, false, false, true]
        );
    }

    #[test]
    fn test_step_match_rows_is_one_value_per_row() {
        // A list of matched times on every row would be rows x matched long.
        let n = 5_000;
        let ts = Int64Array::from((0..n).map(Some).collect::<Vec<_>>());
        let masks: Vec<i64> = (0..n).map(|i| if i == 0 { 1 } else { 2 }).collect();
        let out = step_match_rows(&ts, &masks, 2, 0, 2);
        assert_eq!(out.len(), n as usize);
        assert_eq!(out.iter().filter(|v| **v).count(), n as usize - 1);
    }

    #[test]
    fn test_step_match_evaluator_output_fits_list_offsets() {
        // A list per row would be 200k x 199,999 items, past i32 offsets; one Boolean is not.
        let n: i64 = 200_000;
        let ts: ArrayRef = Arc::new(Int64Array::from((0..n).collect::<Vec<_>>()));
        let first: ArrayRef = Arc::new(BooleanArray::from(
            (0..n).map(|i| i == 0).collect::<Vec<_>>(),
        ));
        let second: ArrayRef = Arc::new(BooleanArray::from(
            (0..n).map(|i| i > 0).collect::<Vec<_>>(),
        ));
        let unused: ArrayRef = Arc::new(Int64Array::from(vec![0; n as usize]));
        let mut evaluator = StepMatchEvaluator {
            window: 0,
            k: 2,
            steps: 2,
        };
        let out = evaluator
            .evaluate_all(
                &[Arc::clone(&unused), unused, ts, first, second],
                n as usize,
            )
            .unwrap();
        assert_eq!(out.data_type(), &DataType::Boolean);
        assert_eq!(out.len(), n as usize);
        assert_eq!(out.as_boolean().true_count(), n as usize - 1);
    }

    #[test]
    fn test_partial_states_merge_to_the_single_pass_result() {
        let events = [(10, 1), (20, 2), (15, 1), (30, 4), (40, 2)];
        let mut whole = SequenceAccumulator {
            output: Output::StepTimes,
            window: 0,
            steps: 3,
            events: events.to_vec(),
        };
        let mut merged = SequenceAccumulator {
            output: Output::StepTimes,
            window: 0,
            steps: 3,
            events: Vec::new(),
        };
        for part in events.chunks(2) {
            let mut partial = SequenceAccumulator {
                output: Output::StepTimes,
                window: 0,
                steps: 3,
                events: part.to_vec(),
            };
            let state: Vec<ArrayRef> = partial
                .state()
                .unwrap()
                .iter()
                .map(|s| s.to_array().unwrap())
                .collect();
            merged.merge_batch(&state).unwrap();
        }
        let expected = whole.evaluate().unwrap();
        assert_eq!(merged.evaluate().unwrap(), expected);
        let times = expected.to_array().unwrap();
        let times = times.as_list::<i32>().value(0);
        assert_eq!(
            times.as_primitive::<Int64Type>(),
            &Int64Array::from(vec![Some(0), Some(5), Some(15)])
        );
    }

    #[tokio::test]
    async fn test_sql_too_many_conditions_is_a_plan_error() {
        let ctx = spans_context().await;
        let conditions = vec!["operation_name = 'auth'"; MAX_STEPS + 1].join(", ");
        let sql = format!("SELECT sequence_depth(0, start_time, {conditions}) FROM spans");
        let err = ctx.sql(&sql).await.unwrap().collect().await.unwrap_err();
        assert!(err.to_string().contains("1 to 20 conditions"), "{err}");
    }

    async fn spans_context() -> SessionContext {
        let schema = Arc::new(Schema::new(vec![
            Field::new("trace_id", DataType::Utf8, false),
            Field::new("start_time", DataType::Int64, false),
            Field::new("operation_name", DataType::Utf8, false),
        ]));
        let batch = |rows: &[(&str, i64, &str)]| {
            RecordBatch::try_new(
                Arc::clone(&schema),
                vec![
                    Arc::new(StringArray::from(
                        rows.iter().map(|r| r.0).collect::<Vec<_>>(),
                    )),
                    Arc::new(Int64Array::from(
                        rows.iter().map(|r| r.1).collect::<Vec<_>>(),
                    )),
                    Arc::new(StringArray::from(
                        rows.iter().map(|r| r.2).collect::<Vec<_>>(),
                    )),
                ],
            )
            .unwrap()
        };
        // Each trace is split across both partitions, so the final aggregate merges partial states.
        let p1 = batch(&[
            ("t1", 10, "auth"),
            ("t1", 30, "query"),
            ("t2", 5, "fetch"),
            ("t2", 15, "query"),
            ("t3", 10, "auth"),
        ]);
        let p2 = batch(&[
            ("t1", 20, "fetch"),
            ("t2", 10, "auth"),
            ("t2", 20, "fetch"),
            ("t3", 10, "fetch"),
            ("t4", 1, "query"),
        ]);
        let table = MemTable::try_new(Arc::clone(&schema), vec![vec![p1], vec![p2]]).unwrap();
        let ctx = SessionContext::new_with_config(SessionConfig::new().with_target_partitions(4));
        register_builtin_udfs(&ctx);
        ctx.register_table("spans", Arc::new(table)).unwrap();
        ctx
    }

    async fn run(ctx: &SessionContext, sql: &str) -> Vec<RecordBatch> {
        ctx.sql(sql).await.unwrap().collect().await.unwrap()
    }

    #[tokio::test]
    async fn test_sql_sequence_aggregates_on_spans() {
        let ctx = spans_context().await;
        let steps = "operation_name = 'auth', operation_name = 'fetch', operation_name = 'query'";
        let sql = format!(
            "SELECT trace_id, sequence_depth(0, start_time, {steps}) AS d, sequence_depth(12, start_time, {steps}) AS dw, sequence_step_times(0, start_time, {steps}) AS st FROM spans GROUP BY trace_id ORDER BY trace_id"
        );
        let batches = run(&ctx, &sql).await;
        let batch = arrow::compute::concat_batches(&batches[0].schema(), &batches).unwrap();
        let ids = batch.column(0).as_string::<i32>();
        let depth = batch.column(1).as_primitive::<Int64Type>();
        let windowed = batch.column(2).as_primitive::<Int64Type>();
        let times = batch.column(3).as_list::<i32>();
        let ids: Vec<&str> = (0..batch.num_rows()).map(|i| ids.value(i)).collect();
        assert_eq!(ids, ["t1", "t2", "t3", "t4"]);
        assert_eq!(depth.values().to_vec(), [3, 2, 1, 0]);
        assert_eq!(windowed.values().to_vec(), [2, 2, 1, 0]);
        let expected: [Vec<Option<i64>>; 4] = [
            vec![Some(0), Some(10), Some(20)],
            vec![Some(0), Some(10), None],
            vec![Some(0), None, None],
            vec![None, None, None],
        ];
        for (i, want) in expected.iter().enumerate() {
            let got = times.value(i);
            assert_eq!(
                got.as_primitive::<Int64Type>(),
                &Int64Array::from(want.clone()),
                "{}",
                ids[i]
            );
        }
    }

    #[tokio::test]
    async fn test_sql_sequence_step_match_on_spans() {
        let ctx = spans_context().await;
        let sql = "SELECT trace_id, start_time, sequence_step_match(0, 2, start_time, operation_name = 'auth', operation_name = 'fetch', operation_name = 'query') OVER (PARTITION BY trace_id ORDER BY start_time) AS m, sequence_depth(0, start_time, operation_name = 'auth', operation_name = 'fetch') OVER (PARTITION BY trace_id) AS d FROM spans ORDER BY trace_id, start_time, operation_name";
        let batches = run(&ctx, sql).await;
        let batch = arrow::compute::concat_batches(&batches[0].schema(), &batches).unwrap();
        assert_eq!(batch.column(2).data_type(), &DataType::Boolean);
        let ids = batch.column(0).as_string::<i32>();
        let ts = batch.column(1).as_primitive::<Int64Type>();
        let marked = batch.column(2).as_boolean();
        let hits: Vec<(&str, i64)> = (0..batch.num_rows())
            .filter(|&i| marked.value(i))
            .map(|i| (ids.value(i), ts.value(i)))
            .collect();
        assert_eq!(hits, [("t1", 20), ("t2", 20)]);
        let depth = batch.column(3).as_primitive::<Int64Type>();
        let t3: Vec<i64> = (0..batch.num_rows())
            .filter(|&i| ids.value(i) == "t3")
            .map(|i| depth.value(i))
            .collect();
        assert_eq!(t3, [1, 1]);
    }

    #[tokio::test]
    async fn test_sql_ungrouped_aggregate_plans_and_runs_after_the_search_rewrite() {
        use sqlparser::{ast::VisitMut, dialect::GenericDialect, parser::Parser};

        use crate::sql::rewriter::add_timestamp::AddTimestampVisitor;

        let schema = Arc::new(Schema::new(vec![
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("start_time", DataType::Int64, false),
            Field::new("operation_name", DataType::Utf8, false),
        ]));
        let batch = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(Int64Array::from(vec![1, 2, 3])),
                Arc::new(Int64Array::from(vec![10, 20, 30])),
                Arc::new(StringArray::from(vec!["auth", "fetch", "query"])),
            ],
        )
        .unwrap();
        let ctx = SessionContext::new();
        register_builtin_udfs(&ctx);
        let table = MemTable::try_new(schema, vec![vec![batch]]).unwrap();
        ctx.register_table("t", Arc::new(table)).unwrap();
        for (sql, want) in [
            (
                "SELECT sequence_depth(0, start_time, operation_name = 'auth', operation_name = 'query') AS d FROM t",
                "2",
            ),
            (
                "SELECT sequence_step_times(0, start_time, operation_name = 'auth', operation_name = 'query') AS st FROM t",
                "[0, 20]",
            ),
        ] {
            // The same gate `Sql::new` applies before it prepends `_timestamp`.
            let mut statement = Parser::parse_sql(&GenericDialect {}, sql)
                .unwrap()
                .remove(0);
            if !config::utils::sql::is_complex_query_stmt(&statement) {
                let _ = statement.visit(&mut AddTimestampVisitor::new());
            }
            let rewritten = statement.to_string();
            let frame = ctx.sql(&rewritten).await;
            let frame = frame.unwrap_or_else(|e| panic!("{rewritten}: {e}"));
            let batches = frame.collect().await.unwrap();
            let shown = arrow::util::pretty::pretty_format_batches(&batches)
                .unwrap()
                .to_string();
            assert!(shown.contains(want), "{rewritten}\n{shown}");
        }
    }

    #[tokio::test]
    async fn test_sql_step_match_rejects_k_past_the_last_step() {
        let ctx = spans_context().await;
        let err = ctx
            .sql("SELECT sequence_step_match(0, 3, start_time, operation_name = 'auth', operation_name = 'fetch') OVER (PARTITION BY trace_id) FROM spans")
            .await
            .unwrap()
            .collect()
            .await
            .unwrap_err();
        assert!(err.to_string().contains("1 <= k <= conditions"), "{err}");
    }
}
