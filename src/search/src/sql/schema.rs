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

use arrow_schema::FieldRef;
use config::{
    ALL_VALUES_COL_NAME, ID_COL_NAME, ORIGINAL_DATA_COL_NAME, TIMESTAMP_COL_NAME, get_config,
    meta::{search::SearchEventType, sql::TableReferenceExt, stream::StreamType},
};
use datafusion::{arrow::datatypes::Schema, common::TableReference};
use hashbrown::{HashMap, HashSet};
use infra::schema::{
    SchemaCache, get_stream_setting_defined_schema_fields, get_stream_setting_fts_fields,
    unwrap_stream_settings,
};
use schema::{effective_uds_fields, required_uds_fields};

pub fn generate_select_star_schema(
    schemas: HashMap<TableReference, Arc<SchemaCache>>,
    columns: &HashMap<TableReference, HashSet<String>>,
    has_original_column: HashMap<TableReference, bool>,
    quick_mode: bool,
    stream_type: StreamType,
    search_event_type: &Option<SearchEventType>,
    need_fst_fields: bool,
) -> HashMap<TableReference, Arc<SchemaCache>> {
    let cfg = get_config();
    let quick_mode_num_fields = cfg.limit.quick_mode_num_fields;
    let mut used_schemas = HashMap::new();
    for (name, schema) in schemas {
        let stream_settings = unwrap_stream_settings(schema.schema());
        let defined_schema_fields = get_stream_setting_defined_schema_fields(&stream_settings);
        let table_type = name.get_stream_type(stream_type);
        let mut uds_fields = effective_uds_fields(table_type, &defined_schema_fields);
        uds_fields.remove(&cfg.common.column_all);
        let uds_present = uds_fields
            .iter()
            .filter(|field| schema.contains_field(field))
            .count();
        let has_original_column = *has_original_column.get(&name).unwrap_or(&false);
        let need_all_column = columns
            .get(&name)
            .is_some_and(|cols| cols.contains(&cfg.common.column_all));
        let fts_fields = if need_fst_fields {
            get_stream_setting_fts_fields(&stream_settings)
        } else {
            Vec::new()
        };
        let projected = if defined_schema_fields.is_empty() {
            None
        } else {
            Some(project_user_defined_schema(
                schema.schema(),
                &uds_fields,
                &fts_fields,
                (need_all_column || !cfg.search.feature_query_exclude_all)
                    .then_some(cfg.common.column_all.as_str()),
            ))
        };
        let quick_active = quick_mode && schema.schema().fields().len() > quick_mode_num_fields;
        if let Some(projected) = projected.as_ref()
            && !(uds_present > quick_mode_num_fields && quick_active)
        {
            used_schemas.insert(name, Arc::new(SchemaCache::new(projected.clone())));
            continue;
        }
        let skip_original_column = !has_original_column
            && !matches!(search_event_type, Some(SearchEventType::DerivedStream))
            && (schema.contains_field(ORIGINAL_DATA_COL_NAME)
                || schema.contains_field(ALL_VALUES_COL_NAME));
        if quick_active || skip_original_column {
            let fields = if quick_active {
                let mut columns = columns.get(&name).cloned().unwrap_or_default();
                if projected.is_some() {
                    columns.insert(ID_COL_NAME.to_string());
                }
                generate_quick_mode_fields(
                    projected.as_ref().unwrap_or(schema.schema()),
                    Some(columns),
                    &fts_fields,
                    skip_original_column,
                    need_fst_fields,
                    table_type,
                )
            } else {
                let mut fields = schema.schema().fields().iter().cloned().collect::<Vec<_>>();
                if !need_fst_fields {
                    fields.retain(|field| {
                        field.name() != ORIGINAL_DATA_COL_NAME
                            && field.name() != ALL_VALUES_COL_NAME
                    });
                }
                fields
            };
            let schema = Arc::new(SchemaCache::new(
                Schema::new(fields).with_metadata(schema.schema().metadata().clone()),
            ));
            used_schemas.insert(name, schema);
        } else {
            used_schemas.insert(name, schema);
        }
    }
    used_schemas
}

pub fn generate_quick_mode_fields(
    schema: &Schema,
    columns: Option<HashSet<String>>,
    fts_fields: &[String],
    skip_original_column: bool,
    need_fst_fields: bool,
    stream_type: StreamType,
) -> Vec<Arc<arrow_schema::Field>> {
    let cfg = get_config();
    let strategy = cfg.limit.quick_mode_strategy.to_lowercase();
    let schema_fields = schema.fields().iter().cloned().collect::<Vec<_>>();
    let mut fields = match strategy.as_str() {
        "last" => {
            let skip = std::cmp::max(0, schema_fields.len() - cfg.limit.quick_mode_num_fields);
            schema_fields.into_iter().skip(skip).collect()
        }
        "both" => {
            let need_num = std::cmp::min(schema_fields.len(), cfg.limit.quick_mode_num_fields);
            let mut inner_fields = schema_fields
                .iter()
                .take(need_num / 2)
                .cloned()
                .collect::<Vec<_>>();
            if schema_fields.len() > inner_fields.len() {
                let skip = std::cmp::max(0, schema_fields.len() + inner_fields.len() - need_num);
                inner_fields.extend(schema_fields.into_iter().skip(skip));
            }
            inner_fields
        }
        _ => {
            // default is first mode
            schema_fields
                .into_iter()
                .take(cfg.limit.quick_mode_num_fields)
                .collect()
        }
    };

    if cfg.search.feature_query_exclude_all {
        fields.retain(|field| {
            field.name() != &cfg.common.column_all
                && field.name() != ORIGINAL_DATA_COL_NAME
                && field.name() != ALL_VALUES_COL_NAME
        });
    }
    let mut fields_name = fields
        .iter()
        .map(|f| f.name().to_string())
        .collect::<HashSet<_>>();

    // check _timestamp column
    if !fields_name.contains(TIMESTAMP_COL_NAME)
        && let Ok(field) = schema.field_with_name(TIMESTAMP_COL_NAME)
    {
        fields.push(Arc::new(field.clone()));
        fields_name.insert(TIMESTAMP_COL_NAME.to_string());
    }
    // truncation must not drop _all when the query config keeps it, as in the UDS projection
    if !cfg.search.feature_query_exclude_all
        && !fields_name.contains(&cfg.common.column_all)
        && let Ok(field) = schema.field_with_name(&cfg.common.column_all)
    {
        fields.push(Arc::new(field.clone()));
        fields_name.insert(cfg.common.column_all.clone());
    }
    // add the selected columns
    if let Some(columns) = columns {
        for column in columns {
            if !fields_name.contains(&column)
                && let Ok(field) = schema.field_with_name(&column)
            {
                fields.push(Arc::new(field.clone()));
                fields_name.insert(column.to_string());
            }
        }
    }
    // check fts fields
    if need_fst_fields {
        for field in fts_fields {
            if !fields_name.contains(field)
                && let Ok(field) = schema.field_with_name(field)
            {
                fields.push(Arc::new(field.clone()));
                fields_name.insert(field.name().to_string());
            }
        }
    } else if fields_name.remove(ALL_VALUES_COL_NAME) {
        fields.retain(|field| field.name() != ALL_VALUES_COL_NAME);
    }

    // check quick mode fields
    for field in config::QUICK_MODEL_FIELDS.iter() {
        if !fields_name.contains(field)
            && let Ok(field) = schema.field_with_name(field)
        {
            fields.push(Arc::new(field.clone()));
            fields_name.insert(field.name().to_string());
        }
    }

    // truncation must not drop the columns a stream type is rendered from
    for field in required_uds_fields(stream_type) {
        if !fields_name.contains(&field)
            && let Ok(field) = schema.field_with_name(&field)
        {
            fields.push(Arc::new(field.clone()));
            fields_name.insert(field.name().to_string());
        }
    }

    if !need_fst_fields && skip_original_column && fields_name.remove(ORIGINAL_DATA_COL_NAME) {
        fields.retain(|field| field.name() != ORIGINAL_DATA_COL_NAME);
    }
    fields
}

// add field from full text search
pub fn generate_schema_fields(
    columns: HashSet<String>,
    schema: &SchemaCache,
    has_match_all: bool,
) -> Vec<FieldRef> {
    let mut columns = columns;

    // 1. add timestamp field
    if !columns.contains(TIMESTAMP_COL_NAME) {
        columns.insert(TIMESTAMP_COL_NAME.to_string());
    }

    // 2. check _o2_id
    if !columns.contains(ID_COL_NAME) {
        columns.insert(ID_COL_NAME.to_string());
    }

    // 3. add field from full text search
    if has_match_all {
        let stream_settings = infra::schema::unwrap_stream_settings(schema.schema());
        let fts_fields = get_stream_setting_fts_fields(&stream_settings);
        for fts_field in fts_fields {
            if schema.field_with_name(&fts_field).is_none() {
                continue;
            }
            columns.insert(fts_field);
        }
    }

    // 4. generate fields
    let mut fields = Vec::with_capacity(columns.len());
    for column in columns {
        if let Some(field) = schema.field_with_name(&column) {
            fields.push(field.clone());
        }
    }
    fields
}

// check if has original column in sql
pub fn has_original_column(
    columns: &HashMap<TableReference, HashSet<String>>,
) -> HashMap<TableReference, bool> {
    let mut has_original_column = HashMap::with_capacity(columns.len());
    for (name, column) in columns.iter() {
        if column.contains(ORIGINAL_DATA_COL_NAME) {
            has_original_column.insert(name.clone(), true);
        } else {
            has_original_column.insert(name.clone(), false);
        }
    }
    has_original_column
}

fn project_user_defined_schema(
    schema: &Schema,
    uds_fields: &HashSet<String>,
    fts_fields: &[String],
    all_column: Option<&str>,
) -> Schema {
    let fields = schema
        .fields()
        .iter()
        .filter(|field| {
            let name = field.name();
            uds_fields.contains(name)
                || name == TIMESTAMP_COL_NAME
                || name == ID_COL_NAME
                || all_column == Some(name.as_str())
                || fts_fields.contains(name)
        })
        .cloned()
        .collect::<Vec<_>>();
    Schema::new_with_metadata(fields, schema.metadata().clone())
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema};
    use config::{ID_COL_NAME, ORIGINAL_DATA_COL_NAME, TIMESTAMP_COL_NAME};
    use datafusion::common::TableReference;
    use hashbrown::{HashMap, HashSet};

    use super::*;

    fn generate_user_defined_schema(
        schema: &SchemaCache,
        stream_type: StreamType,
        defined_schema_fields: Vec<String>,
        need_all_column: bool,
    ) -> Arc<SchemaCache> {
        let cfg = get_config();
        let mut fields = effective_uds_fields(stream_type, &defined_schema_fields);
        fields.remove(&cfg.common.column_all);
        Arc::new(SchemaCache::new(project_user_defined_schema(
            schema.schema(),
            &fields,
            &[],
            (need_all_column || !cfg.search.feature_query_exclude_all)
                .then_some(cfg.common.column_all.as_str()),
        )))
    }

    #[test]
    fn test_has_original_column_with_original() {
        let mut columns = HashMap::new();
        let mut table_columns = HashSet::new();
        table_columns.insert(ORIGINAL_DATA_COL_NAME.to_string());
        table_columns.insert("other_field".to_string());

        let table_ref = TableReference::bare("test_table");
        columns.insert(table_ref.clone(), table_columns);

        let result = has_original_column(&columns);

        assert_eq!(result.len(), 1);
        assert_eq!(result.get(&table_ref), Some(&true));
    }

    #[test]
    fn test_has_original_column_without_original() {
        let mut columns = HashMap::new();
        let mut table_columns = HashSet::new();
        table_columns.insert("field1".to_string());
        table_columns.insert("field2".to_string());

        let table_ref = TableReference::bare("test_table");
        columns.insert(table_ref.clone(), table_columns);

        let result = has_original_column(&columns);

        assert_eq!(result.len(), 1);
        assert_eq!(result.get(&table_ref), Some(&false));
    }

    #[test]
    fn test_has_original_column_multiple_tables() {
        let mut columns = HashMap::new();

        // Table 1 - has original
        let mut table1_columns = HashSet::new();
        table1_columns.insert(ORIGINAL_DATA_COL_NAME.to_string());
        table1_columns.insert("field1".to_string());
        let table1_ref = TableReference::bare("table1");
        columns.insert(table1_ref.clone(), table1_columns);

        // Table 2 - no original
        let mut table2_columns = HashSet::new();
        table2_columns.insert("field2".to_string());
        table2_columns.insert("field3".to_string());
        let table2_ref = TableReference::bare("table2");
        columns.insert(table2_ref.clone(), table2_columns);

        let result = has_original_column(&columns);

        assert_eq!(result.len(), 2);
        assert_eq!(result.get(&table1_ref), Some(&true));
        assert_eq!(result.get(&table2_ref), Some(&false));
    }

    #[test]
    fn test_has_original_column_empty_input() {
        let columns = HashMap::new();
        let result = has_original_column(&columns);
        assert!(result.is_empty());
    }

    #[test]
    fn test_has_original_column_empty_table_columns() {
        let mut columns = HashMap::new();
        let table_columns = HashSet::new();
        let table_ref = TableReference::bare("empty_table");
        columns.insert(table_ref.clone(), table_columns);

        let result = has_original_column(&columns);

        assert_eq!(result.len(), 1);
        assert_eq!(result.get(&table_ref), Some(&false));
    }

    #[test]
    fn test_generate_quick_mode_fields_first_strategy() {
        let fields = vec![
            Arc::new(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)),
            Arc::new(Field::new("field1", DataType::Utf8, true)),
            Arc::new(Field::new("field2", DataType::Int32, true)),
            Arc::new(Field::new("field3", DataType::Float64, true)),
            Arc::new(Field::new("field4", DataType::Boolean, true)),
        ];
        let schema = Schema::new(fields);

        // Mock config - default strategy is "first"
        let result = generate_quick_mode_fields(&schema, None, &[], false, false, StreamType::Logs);

        // Should include timestamp and some fields (exact count depends on config)
        assert!(!result.is_empty());
        assert!(result.iter().any(|f| f.name() == TIMESTAMP_COL_NAME));
    }

    #[test]
    fn test_generate_quick_mode_fields_with_columns() {
        let cutoff = get_config().limit.quick_mode_num_fields;
        for position in [0, cutoff, cutoff * 2] {
            let mut fields = (0..cutoff * 2 + 1)
                .map(|i| Field::new(format!("field{i}"), DataType::Utf8, true))
                .collect::<Vec<_>>();
            fields.insert(
                position,
                Field::new(ORIGINAL_DATA_COL_NAME, DataType::Utf8, true),
            );
            fields.push(Field::new("selected_field", DataType::Float64, true));
            fields.push(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false));
            let schema = Schema::new(fields);
            let columns = HashSet::from([
                "selected_field".to_string(),
                ORIGINAL_DATA_COL_NAME.to_string(),
            ]);

            let result = generate_quick_mode_fields(
                &schema,
                Some(columns),
                &[],
                false,
                false,
                StreamType::Logs,
            );

            for name in [TIMESTAMP_COL_NAME, "selected_field", ORIGINAL_DATA_COL_NAME] {
                assert_eq!(
                    result.iter().filter(|f| f.name() == name).count(),
                    1,
                    "{name} at {position} missing or duplicated"
                );
            }
        }
    }

    #[test]
    fn test_generate_quick_mode_fields_keeps_builtin_fields() {
        // Past the cutoff by construction, so only the built-in list can bring it back.
        let over_cutoff = get_config().limit.quick_mode_num_fields + 100;
        let mut fields = (0..over_cutoff)
            .map(|i| Arc::new(Field::new(format!("field{i}"), DataType::Utf8, true)))
            .collect::<Vec<_>>();
        fields.push(Arc::new(Field::new("service", DataType::Utf8, true)));
        let schema = Schema::new(fields);

        let result = generate_quick_mode_fields(&schema, None, &[], false, false, StreamType::Logs);

        assert!(result.iter().any(|f| f.name() == "service"));
    }

    #[test]
    fn test_generate_quick_mode_fields_keeps_trace_fields() {
        // Not in the built-in default list, so only the stream type guard can bring them back.
        let trace_fields = [
            "span_status",
            "span_kind",
            "events",
            "reference_parent_span_id",
        ];
        let over_cutoff = get_config().limit.quick_mode_num_fields + 100;
        let mut fields = (0..over_cutoff)
            .map(|i| Arc::new(Field::new(format!("field{i}"), DataType::Utf8, true)))
            .collect::<Vec<_>>();
        for name in trace_fields {
            fields.push(Arc::new(Field::new(name, DataType::Utf8, true)));
        }
        let schema = Schema::new(fields);

        let result =
            generate_quick_mode_fields(&schema, None, &[], false, false, StreamType::Traces);

        for name in trace_fields {
            assert!(result.iter().any(|f| f.name() == name), "missing {name}");
        }

        let logs = generate_quick_mode_fields(&schema, None, &[], false, false, StreamType::Logs);
        assert!(!logs.iter().any(|f| f.name() == "span_status"));
    }

    #[test]
    fn test_generate_quick_mode_fields_no_duplicates() {
        // A column several guards can add must appear once, or DataFusion rejects the plan.
        let over_cutoff = get_config().limit.quick_mode_num_fields + 100;
        let mut fields = (0..over_cutoff)
            .map(|i| Arc::new(Field::new(format!("field{i}"), DataType::Utf8, true)))
            .collect::<Vec<_>>();
        for name in ["message", "service_name", "session_id", "trace_id"] {
            fields.push(Arc::new(Field::new(name, DataType::Utf8, true)));
        }
        let schema = Schema::new(fields);

        let result = generate_quick_mode_fields(
            &schema,
            None,
            &["message".to_string(), "service_name".to_string()],
            false,
            true,
            StreamType::Traces,
        );

        let mut names = HashSet::new();
        for field in &result {
            assert!(names.insert(field.name()), "duplicate {}", field.name());
        }
        assert!(result.iter().any(|f| f.name() == "session_id"));
    }

    #[test]
    fn test_generate_quick_mode_fields_skip_original() {
        let fields = vec![
            Arc::new(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)),
            Arc::new(Field::new(ORIGINAL_DATA_COL_NAME, DataType::Utf8, true)),
            Arc::new(Field::new("field1", DataType::Utf8, true)),
        ];
        let schema = Schema::new(fields);

        let result = generate_quick_mode_fields(
            &schema,
            None,
            &[],
            true, // skip_original_column = true
            false,
            StreamType::Logs,
        );

        // Should not include original data column
        assert!(!result.iter().any(|f| f.name() == ORIGINAL_DATA_COL_NAME));
        assert!(result.iter().any(|f| f.name() == TIMESTAMP_COL_NAME));
    }

    #[test]
    fn test_generate_quick_mode_fields_with_fts_fields() {
        let cutoff = get_config().limit.quick_mode_num_fields;
        for position in [0, cutoff, cutoff * 2] {
            for auxiliary in [ORIGINAL_DATA_COL_NAME, ALL_VALUES_COL_NAME] {
                let mut fields = (0..cutoff * 2 + 1)
                    .map(|i| Field::new(format!("field{i}"), DataType::Utf8, true))
                    .collect::<Vec<_>>();
                fields.insert(position, Field::new(auxiliary, DataType::Utf8, true));
                let schema = Schema::new(fields);

                let result = generate_quick_mode_fields(
                    &schema,
                    None,
                    &[auxiliary.to_string()],
                    true,
                    true,
                    StreamType::Logs,
                );

                assert_eq!(
                    result
                        .iter()
                        .filter(|field| field.name() == auxiliary)
                        .count(),
                    1,
                    "{auxiliary} at {position} missing or duplicated"
                );
            }
        }
    }

    #[test]
    fn test_generate_schema_fields_basic() {
        let fields = vec![
            Arc::new(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)),
            Arc::new(Field::new(ID_COL_NAME, DataType::Utf8, false)),
            Arc::new(Field::new("field1", DataType::Utf8, true)),
            Arc::new(Field::new("field2", DataType::Int32, true)),
        ];
        let schema_cache = SchemaCache::new(Schema::new(fields));

        let mut columns = HashSet::new();
        columns.insert("field1".to_string());

        let result = generate_schema_fields(columns, &schema_cache, false);

        // Should include timestamp, ID, and requested field
        let field_names: HashSet<String> = result.iter().map(|f| f.name().to_string()).collect();
        assert!(field_names.contains(TIMESTAMP_COL_NAME));
        assert!(field_names.contains(ID_COL_NAME));
        assert!(field_names.contains("field1"));
    }

    #[test]
    fn test_generate_schema_fields_missing_timestamp_and_id() {
        let fields = vec![
            Arc::new(Field::new("field1", DataType::Utf8, true)),
            Arc::new(Field::new("field2", DataType::Int32, true)),
            Arc::new(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)),
            Arc::new(Field::new(ID_COL_NAME, DataType::Utf8, false)),
        ];
        let schema = Schema::new(fields);
        let schema_cache = SchemaCache::new(schema);

        let mut columns = HashSet::new();
        columns.insert("field1".to_string());
        // Note: not including timestamp or ID in columns

        let result = generate_schema_fields(columns, &schema_cache, false);

        // Should automatically include timestamp and ID
        let field_names: HashSet<String> = result.iter().map(|f| f.name().to_string()).collect();
        assert!(field_names.contains(TIMESTAMP_COL_NAME));
        assert!(field_names.contains(ID_COL_NAME));
        assert!(field_names.contains("field1"));
    }

    #[test]
    fn test_generate_schema_fields_nonexistent_field() {
        let fields = vec![
            Arc::new(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)),
            Arc::new(Field::new(ID_COL_NAME, DataType::Utf8, false)),
            Arc::new(Field::new("existing_field", DataType::Utf8, true)),
        ];
        let schema_cache = SchemaCache::new(Schema::new(fields));

        let mut columns = HashSet::new();
        columns.insert("existing_field".to_string());
        columns.insert("nonexistent_field".to_string());

        let result = generate_schema_fields(columns, &schema_cache, false);

        // Should only include fields that exist in schema
        let field_names: HashSet<String> = result.iter().map(|f| f.name().to_string()).collect();
        assert!(field_names.contains("existing_field"));
        assert!(!field_names.contains("nonexistent_field"));
    }

    // Test constants and field name validation

    #[test]
    fn test_table_reference_creation() {
        let table_ref1 = TableReference::bare("test_table");
        let table_ref2 = TableReference::bare("test_table");

        // Test that table references with same name are equal
        assert_eq!(table_ref1, table_ref2);

        let table_ref3 = TableReference::bare("different_table");
        assert_ne!(table_ref1, table_ref3);
    }

    #[test]
    fn test_generate_user_defined_schema_basic() {
        let fields = vec![
            Arc::new(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)),
            Arc::new(Field::new(ID_COL_NAME, DataType::Utf8, false)),
            Arc::new(Field::new("custom_field", DataType::Utf8, true)),
        ];
        let schema_cache = SchemaCache::new(Schema::new(fields));
        let defined = vec!["custom_field".to_string()];

        let result = generate_user_defined_schema(&schema_cache, StreamType::Logs, defined, false);
        let schema = result.schema();
        let names: HashSet<_> = schema.fields().iter().map(|f| f.name().as_str()).collect();
        assert!(names.contains(TIMESTAMP_COL_NAME));
        assert!(names.contains(ID_COL_NAME));
        assert!(names.contains("custom_field"));
    }

    #[test]
    fn test_generate_user_defined_schema_field_not_in_schema_is_filtered() {
        // defined_schema_fields references a field that doesn't exist in the schema
        let fields = vec![
            Arc::new(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)),
            Arc::new(Field::new(ID_COL_NAME, DataType::Utf8, false)),
        ];
        let schema_cache = SchemaCache::new(Schema::new(fields));
        let defined = vec!["nonexistent_field".to_string()];

        let result = generate_user_defined_schema(&schema_cache, StreamType::Logs, defined, false);
        let schema = result.schema();
        let names: HashSet<_> = schema.fields().iter().map(|f| f.name().as_str()).collect();
        assert!(!names.contains("nonexistent_field"));
        assert!(names.contains(TIMESTAMP_COL_NAME));
        assert!(names.contains(ID_COL_NAME));
    }

    #[test]
    fn test_generate_user_defined_schema_need_all_column_true() {
        let cfg = config::get_config();
        let all_col = cfg.common.column_all.as_str();
        let fields = vec![
            Arc::new(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)),
            Arc::new(Field::new(ID_COL_NAME, DataType::Utf8, false)),
            Arc::new(Field::new(all_col, DataType::Utf8, true)),
            Arc::new(Field::new("f1", DataType::Utf8, true)),
        ];
        let schema_cache = SchemaCache::new(Schema::new(fields));
        let defined = vec!["f1".to_string()];

        let result = generate_user_defined_schema(&schema_cache, StreamType::Logs, defined, true);
        let schema = result.schema();
        let names: HashSet<_> = schema.fields().iter().map(|f| f.name().as_str()).collect();
        assert!(names.contains(all_col));
        assert!(names.contains("f1"));
    }

    #[test]
    fn test_generate_schema_fields_has_match_all_true() {
        // has_match_all=true enters the FTS branch even when FTS fields list is empty
        let fields = vec![
            Arc::new(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)),
            Arc::new(Field::new(ID_COL_NAME, DataType::Utf8, false)),
            Arc::new(Field::new("field1", DataType::Utf8, true)),
        ];
        let schema_cache = SchemaCache::new(Schema::new(fields));

        let mut columns = HashSet::new();
        columns.insert("field1".to_string());

        let result = generate_schema_fields(columns, &schema_cache, true);
        let names: HashSet<_> = result.iter().map(|f| f.name().as_str()).collect();
        assert!(names.contains(TIMESTAMP_COL_NAME));
        assert!(names.contains(ID_COL_NAME));
        assert!(names.contains("field1"));
    }

    #[test]
    fn test_generate_user_defined_schema_keeps_required_columns_missing_from_saved_list() {
        let fields = vec![
            Arc::new(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)),
            Arc::new(Field::new("service_name", DataType::Utf8, true)),
            Arc::new(Field::new("trace_id", DataType::Utf8, true)),
            Arc::new(Field::new("span_id", DataType::Utf8, true)),
        ];
        let schema_cache = SchemaCache::new(Schema::new(fields));
        let defined = vec!["service_name".to_string()];

        let result =
            generate_user_defined_schema(&schema_cache, StreamType::Profiles, defined, false);
        let names: HashSet<_> = result
            .schema()
            .fields()
            .iter()
            .map(|f| f.name().as_str())
            .collect();
        assert!(names.contains("trace_id"));
        assert!(names.contains("span_id"));
        assert!(names.contains("service_name"));
    }

    #[test]
    fn test_quick_mode_width_counts_required_columns() {
        let cutoff = config::get_config().limit.quick_mode_num_fields;
        let mut fields = vec![
            Arc::new(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)),
            // packed historical column sits early in the schema, inside the truncation window
            Arc::new(Field::new("packed_col", DataType::Utf8, true)),
        ];
        let mut defined = Vec::new();
        for i in 0..cutoff {
            let name = format!("user_field_{i}");
            fields.push(Arc::new(Field::new(&name, DataType::Utf8, true)));
            defined.push(name);
        }
        fields.push(Arc::new(Field::new("trace_id", DataType::Utf8, true)));
        let settings = config::meta::stream::StreamSettings {
            defined_schema_fields: defined,
            ..Default::default()
        };
        let metadata = std::collections::HashMap::from([(
            "settings".to_string(),
            config::utils::json::to_string(&settings).unwrap(),
        )]);
        let name = TableReference::bare("profiles_stream");
        let schema = Arc::new(SchemaCache::new(Schema::new_with_metadata(
            fields, metadata,
        )));
        let mut columns = HashMap::new();
        let mut requested = HashSet::new();
        requested.insert("trace_id".to_string());
        columns.insert(name.clone(), requested);

        let mut schemas = HashMap::new();
        schemas.insert(name.clone(), schema.clone());
        let quick = generate_select_star_schema(
            schemas,
            &columns,
            HashMap::new(),
            true,
            StreamType::Profiles,
            &None,
            false,
        );
        let names: HashSet<_> = quick[&name]
            .schema()
            .fields()
            .iter()
            .map(|f| f.name().to_string())
            .collect();
        assert!(names.contains("trace_id"));
        // saved + required crosses the cutoff, so quick mode truncates the saved tail
        assert!(!names.contains(&format!("user_field_{}", cutoff - 1)));
        // truncation runs over the UDS projection, so early packed columns stay hidden
        assert!(!names.contains("packed_col"));

        let mut schemas = HashMap::new();
        schemas.insert(name.clone(), schema);
        let full = generate_select_star_schema(
            schemas,
            &columns,
            HashMap::new(),
            false,
            StreamType::Profiles,
            &None,
            false,
        );
        let names: HashSet<_> = full[&name]
            .schema()
            .fields()
            .iter()
            .map(|f| f.name().to_string())
            .collect();
        // quick mode off: the UDS projection still applies, packed columns stay hidden
        assert!(names.contains("trace_id"));
        assert!(names.contains(&format!("user_field_{}", cutoff - 1)));
        assert!(!names.contains("packed_col"));
    }

    #[test]
    fn test_select_star_uses_table_stream_type_for_uds() {
        let fields = vec![
            Arc::new(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)),
            Arc::new(Field::new("service_name", DataType::Utf8, true)),
            Arc::new(Field::new("trace_id", DataType::Utf8, true)),
        ];
        let settings = config::meta::stream::StreamSettings {
            defined_schema_fields: vec!["service_name".to_string()],
            ..Default::default()
        };
        let metadata = std::collections::HashMap::from([(
            "settings".to_string(),
            config::utils::json::to_string(&settings).unwrap(),
        )]);
        let name = TableReference::partial("profiles", "p");
        let mut schemas = HashMap::new();
        schemas.insert(
            name.clone(),
            Arc::new(SchemaCache::new(Schema::new_with_metadata(
                fields, metadata,
            ))),
        );

        let result = generate_select_star_schema(
            schemas,
            &HashMap::new(),
            HashMap::new(),
            false,
            StreamType::Logs,
            &None,
            false,
        );

        let names: HashSet<_> = result[&name]
            .schema()
            .fields()
            .iter()
            .map(|f| f.name().to_string())
            .collect();
        assert!(names.contains("trace_id"));
        assert!(names.contains("service_name"));
    }

    #[test]
    fn test_quick_mode_keeps_fts_columns_for_uds_streams() {
        let cutoff = get_config().limit.quick_mode_num_fields;
        let mut failures = Vec::new();
        for width in [1, cutoff + 1] {
            let mut fields = vec![
                Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false),
                Field::new(ID_COL_NAME, DataType::Utf8, false),
                Field::new("packed_col", DataType::Utf8, true),
                Field::new(ORIGINAL_DATA_COL_NAME, DataType::Utf8, true),
                Field::new(ALL_VALUES_COL_NAME, DataType::Utf8, true),
                Field::new("message", DataType::Utf8, true),
            ];
            let mut defined = Vec::new();
            for i in 0..width {
                let name = format!("user_field_{i}");
                fields.push(Field::new(&name, DataType::Utf8, true));
                defined.push(name);
            }
            let settings = config::meta::stream::StreamSettings {
                defined_schema_fields: defined,
                index_original_data: true,
                index_all_values: true,
                full_text_search_keys: vec!["message".to_string()],
                ..Default::default()
            };
            let metadata = std::collections::HashMap::from([(
                "settings".to_string(),
                config::utils::json::to_string(&settings).unwrap(),
            )]);
            let name = TableReference::bare("logs_stream");
            let schema = Arc::new(SchemaCache::new(Schema::new_with_metadata(
                fields, metadata,
            )));
            for quick in [false, true] {
                let result = generate_select_star_schema(
                    HashMap::from([(name.clone(), schema.clone())]),
                    &HashMap::new(),
                    HashMap::new(),
                    quick,
                    StreamType::Logs,
                    &None,
                    true,
                );
                let projected = result[&name].schema();
                let names: HashSet<_> = projected
                    .fields()
                    .iter()
                    .map(|f| f.name().as_str())
                    .collect();
                for required in [
                    TIMESTAMP_COL_NAME,
                    ID_COL_NAME,
                    "message",
                    ORIGINAL_DATA_COL_NAME,
                    ALL_VALUES_COL_NAME,
                ] {
                    if !names.contains(required) {
                        failures.push(format!("{required} missing, quick={quick}, width={width}"));
                    }
                }
                assert!(!names.contains("packed_col"));
                assert_eq!(projected.metadata(), schema.schema().metadata());
                if !quick || width == 1 {
                    let expected = schema
                        .schema()
                        .fields()
                        .iter()
                        .filter(|f| f.name() != "packed_col")
                        .cloned()
                        .collect::<Vec<_>>();
                    if projected.fields().as_ref() != expected.as_slice() {
                        failures.push(format!(
                            "projection order differs, quick={quick}, width={width}"
                        ));
                    }
                }
            }
        }
        assert!(failures.is_empty(), "{}", failures.join("; "));
    }

    #[test]
    fn test_select_star_all_column_policy() {
        let cfg = get_config();
        let cutoff = cfg.limit.quick_mode_num_fields;
        for position in [0, cutoff, cutoff * 2] {
            let mut fields = (0..cutoff * 2 + 1)
                .map(|i| Field::new(format!("user_field_{i}"), DataType::Utf8, true))
                .collect::<Vec<_>>();
            let defined = fields.iter().map(|f| f.name().clone()).collect();
            fields.insert(
                position,
                Field::new(&cfg.common.column_all, DataType::Utf8, true),
            );
            fields.push(Field::new("packed_col", DataType::Utf8, true));
            let settings = config::meta::stream::StreamSettings {
                defined_schema_fields: defined,
                ..Default::default()
            };
            let metadata = std::collections::HashMap::from([(
                "settings".to_string(),
                config::utils::json::to_string(&settings).unwrap(),
            )]);
            let name = TableReference::bare("logs_stream");
            let schema = Arc::new(SchemaCache::new(Schema::new_with_metadata(
                fields, metadata,
            )));
            for quick in [false, true] {
                for explicit in [false, true] {
                    let columns = if explicit {
                        HashMap::from([(
                            name.clone(),
                            HashSet::from([cfg.common.column_all.clone()]),
                        )])
                    } else {
                        HashMap::new()
                    };
                    let result = generate_select_star_schema(
                        HashMap::from([(name.clone(), schema.clone())]),
                        &columns,
                        HashMap::new(),
                        quick,
                        StreamType::Logs,
                        &None,
                        false,
                    );
                    let names: HashSet<_> = result[&name]
                        .schema()
                        .fields()
                        .iter()
                        .map(|f| f.name().as_str())
                        .collect();
                    assert_eq!(
                        names.contains(cfg.common.column_all.as_str()),
                        explicit || !cfg.search.feature_query_exclude_all,
                        "quick={quick}, explicit={explicit}, position={position}"
                    );
                    assert!(!names.contains("packed_col"));
                }
            }
        }
    }
}
