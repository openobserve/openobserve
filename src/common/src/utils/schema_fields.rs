// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

use arrow_schema::Schema;
use config::{
    ALL_VALUES_COL_NAME, ID_COL_NAME, ORIGINAL_DATA_COL_NAME, TIMESTAMP_COL_NAME, get_config,
    meta::{
        promql::{
            BUCKET_LABEL, EXEMPLARS_LABEL, HASH_LABEL, NAME_LABEL, QUANTILE_LABEL, VALUE_LABEL,
        },
        stream::StreamType,
    },
};
use hashbrown::HashSet;
use infra::schema::SchemaCache;

pub fn generate_schema_for_defined_schema_fields(
    stream_type: StreamType,
    schema: &SchemaCache,
    fields: &[String],
    need_original: bool,
    index_original_data: bool,
    index_all_values: bool,
) -> SchemaCache {
    if fields.is_empty() || schema.fields_map().len() < fields.len() + 10 {
        return schema.clone();
    }

    let cfg = get_config();
    let mut fields =
        check_schema_for_defined_schema_fields(stream_type, schema.schema(), fields.to_vec());
    fields.insert(TIMESTAMP_COL_NAME.to_string());
    fields.insert(cfg.common.column_all.to_string());
    if need_original || index_original_data {
        fields.insert(ID_COL_NAME.to_string());
        fields.insert(ORIGINAL_DATA_COL_NAME.to_string());
    }
    if index_all_values {
        fields.insert(ALL_VALUES_COL_NAME.to_string());
    }

    let mut new_fields = Vec::with_capacity(fields.len());
    for field in fields {
        if let Some(index) = schema.fields_map().get(&field) {
            new_fields.push(schema.schema().fields()[*index].clone());
        }
    }
    new_fields.sort_by(|a, b| a.name().cmp(b.name()));

    SchemaCache::new(Schema::new_with_metadata(
        new_fields,
        schema.schema().metadata().clone(),
    ))
}

pub fn check_schema_for_defined_schema_fields(
    stream_type: StreamType,
    schema: &Schema,
    fields: Vec<String>,
) -> HashSet<String> {
    let mut fields: HashSet<String> = fields.into_iter().collect();
    match stream_type {
        StreamType::Logs => {}
        StreamType::Metrics => {
            fields.insert(NAME_LABEL.to_string());
            fields.insert(HASH_LABEL.to_string());
            fields.insert(BUCKET_LABEL.to_string());
            fields.insert(QUANTILE_LABEL.to_string());
            fields.insert(EXEMPLARS_LABEL.to_string());
            fields.insert(VALUE_LABEL.to_string());
            fields.insert("trace_id".to_string());
            fields.insert("span_id".to_string());
        }
        StreamType::Traces => {
            for field in [
                "service_name",
                "operation_name",
                "trace_id",
                "span_id",
                "span_kind",
                "span_status",
                "reference_parent_span_id",
                "reference_parent_trace_id",
                "reference_ref_type",
                "start_time",
                "end_time",
                "duration",
                "events",
            ] {
                fields.insert(field.to_string());
            }
            for field in schema.fields() {
                let name = field.name();
                if name.starts_with("gen_ai_")
                    || name.starts_with("llm_")
                    || name == "user_id"
                    || name == "session_id"
                {
                    fields.insert(name.to_string());
                }
            }
        }
        _ => {}
    }
    fields
}
