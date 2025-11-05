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

use arrow_schema::FieldRef;
use config::{
    ALL_VALUES_COL_NAME, ID_COL_NAME, ORIGINAL_DATA_COL_NAME, TIMESTAMP_COL_NAME, get_config,
    meta::search::SearchEventType,
};
use datafusion::{arrow::datatypes::Schema, common::TableReference};
use hashbrown::{HashMap, HashSet};
use infra::schema::{
    SchemaCache, get_stream_setting_defined_schema_fields, get_stream_setting_fts_fields,
    unwrap_stream_settings,
};

pub fn generate_select_star_schema(
    schemas: HashMap<TableReference, Arc<SchemaCache>>,
    columns: &HashMap<TableReference, HashSet<String>>,
    has_original_column: HashMap<TableReference, bool>,
    quick_mode: bool,
    quick_mode_num_fields: usize,
    search_event_type: &Option<SearchEventType>,
    need_fst_fields: bool,
) -> HashMap<TableReference, Arc<SchemaCache>> {
    let cfg = get_config();
    let mut used_schemas = HashMap::new();
    for (name, schema) in schemas {
        let stream_settings = unwrap_stream_settings(schema.schema());
        let defined_schema_fields = get_stream_setting_defined_schema_fields(&stream_settings);
        let has_original_column = *has_original_column.get(&name).unwrap_or(&false);
        let need_all_column = columns
            .get(&name)
            .map(|cols| cols.contains(&cfg.common.column_all))
            .unwrap_or(false);
        // check if it is user defined schema
        if defined_schema_fields.is_empty() || defined_schema_fields.len() > quick_mode_num_fields {
            let quick_mode = quick_mode && schema.schema().fields().len() > quick_mode_num_fields;
            // don't automatically skip _original for scheduled pipeline searches
            let skip_original_column = !has_original_column
                && !matches!(search_event_type, Some(SearchEventType::DerivedStream))
                && (schema.contains_field(ORIGINAL_DATA_COL_NAME)
                    || schema.contains_field(ALL_VALUES_COL_NAME));
            if quick_mode || skip_original_column {
                let fields = if quick_mode {
                    let mut columns = columns.get(&name).cloned();
                    // filter columns by defined schema fields
                    if !defined_schema_fields.is_empty() {
                        let uds_columns = defined_schema_fields.iter().collect::<HashSet<_>>();
                        if let Some(columns) = columns.as_mut() {
                            columns.retain(|column| uds_columns.contains(column));
                        }
                    }
                    let fts_fields = get_stream_setting_fts_fields(&stream_settings);
                    generate_quick_mode_fields(
                        schema.schema(),
                        columns,
                        &fts_fields,
                        skip_original_column,
                        need_fst_fields,
                    )
                } else {
                    // skip selecting "_original" column if `SELECT * ...`
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
        } else {
            used_schemas.insert(
                name,
                generate_user_defined_schema(
                    schema.as_ref(),
                    defined_schema_fields,
                    need_all_column,
                ),
            );
        }
    }
    used_schemas
}

pub fn generate_user_defined_schema(
    schema: &SchemaCache,
    defined_schema_fields: Vec<String>,
    need_all_column: bool,
) -> Arc<SchemaCache> {
    let cfg = get_config();
    let mut fields: HashSet<String> = defined_schema_fields.iter().cloned().collect();
    fields.insert(TIMESTAMP_COL_NAME.to_string());
    fields.insert(ID_COL_NAME.to_string());

    if need_all_column || !cfg.common.feature_query_exclude_all {
        fields.insert(cfg.common.column_all.to_string());
    }
    let new_fields = fields
        .iter()
        .filter_map(|name| schema.field_with_name(name).cloned())
        .collect::<Vec<_>>();

    Arc::new(SchemaCache::new(
        Schema::new(new_fields).with_metadata(schema.schema().metadata().clone()),
    ))
}

pub fn generate_quick_mode_fields(
    schema: &Schema,
    columns: Option<HashSet<String>>,
    fts_fields: &[String],
    skip_original_column: bool,
    need_fst_fields: bool,
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

    let mut fields_name = fields
        .iter()
        .map(|f| f.name().to_string())
        .collect::<HashSet<_>>();

    // check _all column
    if cfg.common.feature_query_exclude_all {
        if fields_name.contains(&cfg.common.column_all) {
            fields.retain(|field| field.name().ne(&cfg.common.column_all));
        }
        if fields_name.contains(ORIGINAL_DATA_COL_NAME) {
            fields.retain(|field| field.name().ne(ORIGINAL_DATA_COL_NAME));
        }
        if fields_name.contains(ALL_VALUES_COL_NAME) {
            fields.retain(|field| field.name().ne(ALL_VALUES_COL_NAME));
        }
    }

    // check _timestamp column
    if !fields_name.contains(TIMESTAMP_COL_NAME)
        && let Ok(field) = schema.field_with_name(TIMESTAMP_COL_NAME)
    {
        fields.push(Arc::new(field.clone()));
        fields_name.insert(TIMESTAMP_COL_NAME.to_string());
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
                fields_name.insert(field.to_string());
            }
        }
    } else if fields_name.contains(ALL_VALUES_COL_NAME) {
        fields.retain(|field| field.name() != ALL_VALUES_COL_NAME);
    }

    // check quick mode fields
    for field in config::QUICK_MODEL_FIELDS.iter() {
        if !fields_name.contains(field)
            && let Ok(field) = schema.field_with_name(field)
        {
            fields.push(Arc::new(field.clone()));
            fields_name.insert(field.to_string());
        }
    }
    if !need_fst_fields && skip_original_column && fields_name.contains(ORIGINAL_DATA_COL_NAME) {
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

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use arrow_schema::{DataType, Field, Schema};
    use config::{ID_COL_NAME, ORIGINAL_DATA_COL_NAME, TIMESTAMP_COL_NAME};
    use datafusion::common::TableReference;
    use hashbrown::{HashMap, HashSet};

    use super::*;

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
        let result = generate_quick_mode_fields(&schema, None, &[], false, false);

        // Should include timestamp and some fields (exact count depends on config)
        assert!(!result.is_empty());
        assert!(result.iter().any(|f| f.name() == TIMESTAMP_COL_NAME));
    }

    #[test]
    fn test_generate_quick_mode_fields_with_columns() {
        let fields = vec![
            Arc::new(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)),
            Arc::new(Field::new("field1", DataType::Utf8, true)),
            Arc::new(Field::new("field2", DataType::Int32, true)),
            Arc::new(Field::new("selected_field", DataType::Float64, true)),
        ];
        let schema = Schema::new(fields);

        let mut columns = HashSet::new();
        columns.insert("selected_field".to_string());

        let result = generate_quick_mode_fields(&schema, Some(columns), &[], false, false);

        // Should include timestamp and selected field
        assert!(result.iter().any(|f| f.name() == TIMESTAMP_COL_NAME));
        assert!(result.iter().any(|f| f.name() == "selected_field"));
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
        );

        // Should not include original data column
        assert!(!result.iter().any(|f| f.name() == ORIGINAL_DATA_COL_NAME));
        assert!(result.iter().any(|f| f.name() == TIMESTAMP_COL_NAME));
    }

    #[test]
    fn test_generate_quick_mode_fields_with_fts_fields() {
        let fields = vec![
            Arc::new(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false)),
            Arc::new(Field::new("fts_field1", DataType::Utf8, true)),
            Arc::new(Field::new("fts_field2", DataType::Utf8, true)),
            Arc::new(Field::new("normal_field", DataType::Int32, true)),
        ];
        let schema = Schema::new(fields);

        let fts_fields = vec!["fts_field1".to_string(), "fts_field2".to_string()];

        let result = generate_quick_mode_fields(
            &schema,
            None,
            &fts_fields,
            false,
            true, // need_fst_fields = true
        );

        // Should include FTS fields
        assert!(result.iter().any(|f| f.name() == "fts_field1"));
        assert!(result.iter().any(|f| f.name() == "fts_field2"));
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
}
