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

mod cache;
mod pruner;
mod reader;

pub(super) use pruner::search;

#[cfg(test)]
mod tests {
    use std::{ops::Range, sync::Arc};

    use arrow::{
        array::{Array, DictionaryArray, RecordBatch, UInt32Array},
        datatypes::{DataType, Field, Int32Type, Schema},
        ipc::writer::FileWriter as ArrowFileWriter,
    };
    use bytes::Bytes;
    use config::{
        TIMESTAMP_COL_NAME,
        meta::promql::{VALUE_LABEL, layout::METRICS_INDEX_ROW_COUNT},
    };
    use promql_parser::label::{MatchOp, Matcher, Matchers};

    use super::{
        pruner::{create_physical_filter, metrics_index_labels},
        reader::{MetricsIndexData, decode_metrics_index, evaluate_metrics_index},
    };

    #[test]
    fn labels_keep_only_matchable_table_labels() {
        let schema = Schema::new(vec![
            Field::new("__hash__", DataType::UInt64, false),
            Field::new("__name__", DataType::Utf8View, false),
            Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
            Field::new("instance", DataType::Utf8View, true),
            Field::new("path", DataType::Utf8View, true),
            Field::new(VALUE_LABEL, DataType::Float64, false),
        ]);
        let matchers = Matchers::new(vec![
            Matcher::new(MatchOp::Equal, "path", "a"),
            Matcher::new(MatchOp::Equal, "path", "b"),
            Matcher::new(MatchOp::NotEqual, VALUE_LABEL, "1"),
            Matcher::new(MatchOp::Equal, "missing_label", "x"),
            Matcher::new(MatchOp::NotEqual, "instance", "i1"),
        ]);
        assert_eq!(
            metrics_index_labels(&schema, &matchers),
            Some(vec!["path".to_string(), "instance".to_string()])
        );

        let only_value = Matchers::new(vec![Matcher::new(MatchOp::Equal, VALUE_LABEL, "1")]);
        assert_eq!(metrics_index_labels(&schema, &only_value), None);
    }

    #[test]
    fn evaluates_and_coalesces_selected_ranges() {
        // dictionary-encoded label column, exactly as the writer produces it;
        // run starts are the prefix sums of the counts: 0, 2, 4, 5
        let paths: DictionaryArray<Int32Type> = vec!["a", "b", "a", "a"].into_iter().collect();
        let schema = Arc::new(Schema::new(vec![
            Field::new(METRICS_INDEX_ROW_COUNT, DataType::UInt32, false),
            Field::new("path", paths.data_type().clone(), false),
        ]));
        let batch = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(UInt32Array::from(vec![2, 2, 1, 3])),
                Arc::new(paths),
            ],
        )
        .unwrap();
        let data = MetricsIndexData {
            schema: Arc::clone(&schema),
            batches: vec![batch],
        };
        let matchers = Matchers::new(vec![Matcher::new(MatchOp::Equal, "path", "a")]);
        let filter = create_physical_filter(&schema, &matchers).unwrap();
        assert!(filter.is_some());

        assert_eq!(
            evaluate_metrics_index(&data, filter.as_deref()).unwrap(),
            vec![0..2, 4..8]
        );

        // no evaluable matcher: every series is selected
        assert_eq!(
            evaluate_metrics_index(&data, None).unwrap(),
            vec![Range { start: 0, end: 8 }]
        );

        // regex matchers go through regexp_like on the label column, which is
        // cast out of its dictionary encoding
        let matchers = Matchers::new(vec![Matcher {
            op: MatchOp::NotRe(regex::Regex::new("a").unwrap()),
            name: "path".to_string(),
            value: "a".to_string(),
        }]);
        let filter = create_physical_filter(&schema, &matchers).unwrap();
        assert_eq!(
            evaluate_metrics_index(&data, filter.as_deref()).unwrap(),
            vec![Range { start: 2, end: 4 }]
        );
    }

    /// Serialize a metrics index with the given label columns (in this order),
    /// dictionary-encoded like the writer's output.
    fn sidecar_bytes(labels: &[(&str, Vec<&str>)], counts: Vec<u32>) -> Bytes {
        let mut fields = vec![Field::new(METRICS_INDEX_ROW_COUNT, DataType::UInt32, false)];
        let mut columns: Vec<Arc<dyn Array>> = vec![Arc::new(UInt32Array::from(counts))];
        for (name, values) in labels {
            let values: DictionaryArray<Int32Type> = values.iter().copied().collect();
            fields.push(Field::new(*name, values.data_type().clone(), true));
            columns.push(Arc::new(values));
        }
        let schema = Arc::new(Schema::new(fields));
        let batch = RecordBatch::try_new(Arc::clone(&schema), columns).unwrap();
        let mut writer = ArrowFileWriter::try_new(Vec::new(), &schema).unwrap();
        writer.write(&batch).unwrap();
        Bytes::from(writer.into_inner().unwrap())
    }

    #[test]
    fn projects_by_name_across_sidecars_with_different_layouts() {
        let labels = vec!["path".to_string(), "instance".to_string()];
        let matchers = Matchers::new(vec![
            Matcher::new(MatchOp::Equal, "path", "a"),
            Matcher::new(MatchOp::Equal, "instance", "i1"),
        ]);

        // file 1: [.., instance, job, path]; file 2: [.., path, instance] —
        // same labels, different positions
        let file1 = sidecar_bytes(
            &[
                ("instance", vec!["i1", "i2", "i1"]),
                ("job", vec!["j", "j", "j"]),
                ("path", vec!["a", "a", "b"]),
            ],
            vec![3, 2, 4],
        );
        let file2 = sidecar_bytes(
            &[("path", vec!["b", "a"]), ("instance", vec!["i1", "i1"])],
            vec![7, 1],
        );
        for (name, bytes, expected) in [
            ("f1", file1, vec![Range { start: 0, end: 3 }]),
            ("f2", file2, vec![Range { start: 7, end: 8 }]),
        ] {
            let data = decode_metrics_index(name, bytes, &labels).unwrap();
            assert_eq!(data.schema.fields().len(), 3, "{name}");
            let filter = create_physical_filter(&data.schema, &matchers).unwrap();
            assert_eq!(
                evaluate_metrics_index(&data, filter.as_deref()).unwrap(),
                expected,
                "{name}"
            );
        }
    }

    #[test]
    fn missing_label_over_selects_instead_of_dropping() {
        let labels = vec!["path".to_string(), "instance".to_string()];
        let matchers = Matchers::new(vec![
            Matcher::new(MatchOp::Equal, "path", "a"),
            Matcher::new(MatchOp::Equal, "instance", "i1"),
        ]);

        // sidecar without `instance`: only the `path` matcher is evaluated
        let partial = sidecar_bytes(&[("path", vec!["a", "b", "a"])], vec![2, 4, 1]);
        let data = decode_metrics_index("partial", partial, &labels).unwrap();
        assert_eq!(data.schema.fields().len(), 2);
        let filter = create_physical_filter(&data.schema, &matchers).unwrap();
        assert!(filter.is_some());
        assert_eq!(
            evaluate_metrics_index(&data, filter.as_deref()).unwrap(),
            vec![0..2, 6..7]
        );

        // sidecar with none of the matched labels: the whole file is selected
        let none = sidecar_bytes(&[("job", vec!["j", "j"])], vec![4, 2]);
        let data = decode_metrics_index("none", none, &labels).unwrap();
        assert_eq!(data.schema.fields().len(), 1);
        let filter = create_physical_filter(&data.schema, &matchers).unwrap();
        assert!(filter.is_none());
        assert_eq!(
            evaluate_metrics_index(&data, filter.as_deref()).unwrap(),
            vec![Range { start: 0, end: 6 }]
        );
    }
}
