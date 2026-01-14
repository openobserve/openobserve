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

use std::{
    borrow::{Borrow, Cow},
    io::{BufRead, Seek},
    sync::Arc,
};

use arrow_json::reader;
use arrow_schema::{ArrowError, DataType, Field, Schema};
use once_cell::sync::Lazy;
use regex::Regex;
use serde_json::{Map, Value};

use super::str::find;
use crate::{
    FxIndexMap, TIMESTAMP_COL_NAME,
    meta::{promql::HASH_LABEL, stream::StreamType},
};

const MAX_PARTITION_KEY_LENGTH: usize = 100;

static RE_CORRECT_STREAM_NAME: Lazy<Regex> = Lazy::new(|| Regex::new(r"[^a-zA-Z0-9_:]+").unwrap());

pub fn infer_json_schema<R: BufRead>(
    reader: R,
    max_read_records: Option<usize>,
    stream_type: StreamType,
) -> Result<Schema, ArrowError> {
    let (schema, _) = reader::infer_json_schema(reader, max_read_records)?;
    Ok(fix_schema(schema, stream_type))
}

pub fn infer_json_schema_from_seekable<R: BufRead + Seek>(
    reader: R,
    max_read_records: Option<usize>,
    stream_type: StreamType,
) -> Result<Schema, ArrowError> {
    let (schema, _) = reader::infer_json_schema_from_seekable(reader, max_read_records)?;
    Ok(fix_schema(schema, stream_type))
}

pub fn infer_json_schema_from_map<I, V>(
    value_iter: I,
    stream_type: impl Into<StreamType>,
) -> Result<Schema, ArrowError>
where
    I: Iterator<Item = V>,
    V: Borrow<Map<String, Value>>,
{
    let mut fields = None;
    for value in value_iter {
        if fields.is_none() {
            fields = Some(FxIndexMap::with_capacity_and_hasher(
                value.borrow().len(),
                Default::default(),
            ));
        }
        infer_json_schema_from_object(fields.as_mut().unwrap(), value.borrow())?;
    }
    let fields = fields.unwrap_or_default();
    let fields = fields
        .into_iter()
        .map(|(_, field)| field)
        .collect::<Vec<_>>();
    Ok(fix_schema(Schema::new(fields), stream_type.into()))
}

pub fn infer_json_schema_from_values<I, V>(
    value_iter: I,
    stream_type: impl Into<StreamType>,
) -> Result<Schema, ArrowError>
where
    I: Iterator<Item = V>,
    V: Borrow<Value>,
{
    let mut fields = None;
    for value in value_iter {
        match value.borrow() {
            Value::Object(v) => {
                if fields.is_none() {
                    fields = Some(FxIndexMap::with_capacity_and_hasher(
                        v.len(),
                        Default::default(),
                    ));
                }
                infer_json_schema_from_object(fields.as_mut().unwrap(), v)?;
            }
            _ => {
                return Err(ArrowError::SchemaError(
                    "Cannot infer schema from non-object value".to_string(),
                ));
            }
        }
    }
    let fields = fields.unwrap_or_default();
    let fields = fields
        .into_iter()
        .map(|(_, field)| field)
        .collect::<Vec<_>>();
    Ok(fix_schema(Schema::new(fields), stream_type.into()))
}

fn infer_json_schema_from_object(
    fields: &mut FxIndexMap<String, Field>,
    value: &Map<String, Value>,
) -> Result<(), ArrowError> {
    for (key, value) in value.iter() {
        match value {
            Value::String(_) => {
                convert_data_type(fields, key, DataType::Utf8)?;
            }
            Value::Number(v) => {
                if v.is_i64() {
                    convert_data_type(fields, key, DataType::Int64)?;
                } else if v.is_u64() {
                    convert_data_type(fields, key, DataType::UInt64)?;
                } else if v.is_f64() {
                    convert_data_type(fields, key, DataType::Float64)?;
                } else {
                    return Err(ArrowError::SchemaError(format!(
                        "Cannot infer schema from non-basic-number type value: {v:?}",
                    )));
                }
            }
            Value::Bool(_) => {
                convert_data_type(fields, key, DataType::Boolean)?;
            }
            Value::Null => {}
            _ => {
                return Err(ArrowError::SchemaError(
                    "Cannot infer schema from non-basic type value".to_string(),
                ));
            }
        }
    }
    Ok(())
}

fn convert_data_type(
    fields: &mut FxIndexMap<String, Field>,
    key: &str,
    data_type: DataType,
) -> Result<(), ArrowError> {
    let Some(f) = fields.get(key) else {
        fields.insert(key.to_string(), Field::new(key, data_type, true));
        return Ok(());
    };
    let f_type = f.data_type();
    if f_type == &data_type {
        return Ok(());
    }
    match (f_type, &data_type) {
        (DataType::LargeUtf8, _) => {}
        (DataType::Utf8, DataType::LargeUtf8) => {
            fields.insert(key.to_string(), Field::new(key, data_type, true));
        }
        (DataType::Utf8, _) => {}
        (DataType::Float64, DataType::UInt64)
        | (DataType::Float64, DataType::Int64)
        | (DataType::Float64, DataType::Boolean) => {}
        (DataType::Int64, DataType::UInt64)
        | (DataType::Int64, DataType::Float64)
        | (DataType::Int64, DataType::Utf8)
        | (DataType::Int64, DataType::LargeUtf8) => {
            fields.insert(key.to_string(), Field::new(key, data_type, true));
        }
        (DataType::UInt64, DataType::Int64)
        | (DataType::UInt64, DataType::Boolean)
        | (DataType::Int64, DataType::Boolean) => {}
        (DataType::UInt64, DataType::Float64)
        | (DataType::UInt64, DataType::Utf8)
        | (DataType::UInt64, DataType::LargeUtf8) => {
            fields.insert(key.to_string(), Field::new(key, data_type, true));
        }
        (DataType::Float64, DataType::Utf8) | (DataType::Float64, DataType::LargeUtf8) => {
            fields.insert(key.to_string(), Field::new(key, data_type, true));
        }

        (DataType::Boolean, _) => {
            fields.insert(key.to_string(), Field::new(key, data_type, true));
        }
        _ => {
            return Err(ArrowError::SchemaError(format!(
                "Cannot infer schema from conflicting types: {f_type:?} and {data_type:?}"
            )));
        }
    }
    Ok(())
}

/// Fix the schema to ensure that the start_time and end_time fields are always present with uint64
/// and the __hash__ field is always present with uint64
/// and that null fields are removed and sort the fields by name.
fn fix_schema(schema: Schema, stream_type: StreamType) -> Schema {
    let mut fields = if stream_type == StreamType::Traces {
        itertools::chain(
            schema.fields().into_iter().filter_map(|f| {
                if f.name() != "start_time"
                    && f.name() != "end_time"
                    && f.data_type() != &DataType::Null
                {
                    Some(f.to_owned())
                } else {
                    None
                }
            }),
            vec![
                Arc::new(Field::new("start_time", DataType::UInt64, true)),
                Arc::new(Field::new("end_time", DataType::UInt64, true)),
            ],
        )
        .collect::<Vec<_>>()
    } else {
        schema
            .fields()
            .into_iter()
            .filter_map(|f| {
                if f.data_type() == &DataType::Null {
                    None
                } else {
                    Some(f.to_owned())
                }
            })
            .collect::<Vec<_>>()
    };
    fields = fields
        .into_iter()
        .map(|x| {
            if x.name() == TIMESTAMP_COL_NAME {
                Arc::new(Field::new(
                    TIMESTAMP_COL_NAME.to_string(),
                    DataType::Int64,
                    false,
                ))
            } else if stream_type == StreamType::Metrics
                && x.data_type() == &DataType::Int64
                && x.name() == HASH_LABEL
            {
                Arc::new(Field::new(x.name().clone(), DataType::UInt64, false))
            } else {
                x
            }
        })
        .collect::<Vec<_>>();
    fields.sort_by(|a, b| a.name().cmp(b.name()));
    Schema::new(fields)
}

// format partition key
pub fn format_partition_key(input: &str) -> String {
    let mut output = String::with_capacity(std::cmp::min(input.len(), MAX_PARTITION_KEY_LENGTH));
    for c in input.chars() {
        if output.len() > MAX_PARTITION_KEY_LENGTH {
            break;
        }
        if c.is_alphanumeric() || c == '=' || c == '-' || c == '_' {
            output.push(c);
        }
    }
    output
}

// format stream name
pub fn format_stream_name(stream_name: String) -> String {
    let replaced = RE_CORRECT_STREAM_NAME.replace_all(&stream_name, "_");

    // Check if any replacements were made
    match replaced {
        Cow::Borrowed(_) => {
            // No replacements were made - check if lowercasing is needed
            if crate::get_config().common.format_stream_name_to_lower
                && stream_name.chars().any(|c| c.is_ascii_uppercase())
            {
                // Has uppercase letters - must allocate and lowercase
                let mut owned = stream_name;
                owned.make_ascii_lowercase();
                owned
            } else {
                // No changes needed - return original string without reallocation
                stream_name
            }
        }
        Cow::Owned(mut owned) => {
            // Replacements were made - check if lowercasing is needed
            if crate::get_config().common.format_stream_name_to_lower
                && owned.chars().any(|c| c.is_ascii_uppercase())
            {
                // Has uppercase letters - lowercase the already-allocated string
                owned.make_ascii_lowercase();
            }
            owned
        }
    }
}

/// match a source is a needed file or not, return true if needed
pub fn filter_source_by_partition_key(source: &str, filters: &[(String, Vec<String>)]) -> bool {
    !filters.iter().any(|(k, v)| {
        let field = format_partition_key(&format!("{k}="));
        find(source, &format!("/{field}"))
            && !v.iter().any(|v| {
                let value = format_partition_key(&format!("{k}={v}"));
                find(source, &format!("/{value}/"))
            })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_format_stream_name_no_changes() {
        // Test case: stream name that doesn't need any changes
        // This should return the original string without reallocation

        // Create a string with a known capacity to help verify the optimization
        let mut original = String::with_capacity(100);
        original.push_str("valid_stream_name_123");
        let original_capacity = original.capacity();
        let original_len = original.len();

        // Call the function - when no changes are needed, it should return the same String
        let result = format_stream_name(original);

        // Verify correctness
        assert_eq!(result, "valid_stream_name_123");

        // Verify that the result has the same capacity (optimization check)
        // When the optimization works, the function returns the original String,
        // so the capacity should be preserved
        // Note: This is a heuristic - if a new String was allocated, it might have
        // a different capacity. When the optimization works, we return the original
        // String which preserves its capacity.
        assert_eq!(
            result.capacity(),
            original_capacity,
            "Optimization check: When no changes are needed, format_stream_name should return the original String (same capacity = no reallocation)"
        );
        assert_eq!(result.len(), original_len);

        // Additional check: verify the string content matches exactly
        assert_eq!(result.as_str(), "valid_stream_name_123");
    }

    #[test]
    fn test_format_stream_name_with_replacements() {
        // Test case: stream name that needs character replacements
        let original = "stream-name with spaces!".to_string();
        let result = format_stream_name(original);

        // Should replace invalid characters with underscores
        assert_eq!(result, "stream_name_with_spaces_");
    }

    #[test]
    fn test_format_stream_name_with_lowercasing() {
        // This test depends on the config setting format_stream_name_to_lower
        // We'll test both scenarios
        let original_upper = "ValidStreamName".to_string();
        let result = format_stream_name(original_upper.clone());

        // The result depends on config, but should be consistent
        let cfg = crate::get_config();
        if cfg.common.format_stream_name_to_lower {
            assert_eq!(result, "validstreamname");
        } else {
            // If no lowercasing config, should return original (no replacements needed)
            assert_eq!(result, original_upper);
        }
    }

    #[test]
    fn test_format_stream_name_combined() {
        // Test case: stream name that needs both replacements and potentially lowercasing
        let original = "My-Stream Name!".to_string();
        let result = format_stream_name(original);

        // Should replace invalid characters
        assert!(result.contains("_"));
        assert!(!result.contains("-"));
        assert!(!result.contains(" "));
        assert!(!result.contains("!"));

        let cfg = crate::get_config();
        if cfg.common.format_stream_name_to_lower {
            assert_eq!(result, "my_stream_name_");
        } else {
            assert_eq!(result, "My_Stream_Name_");
        }
    }

    #[test]
    fn test_matches_by_partition_key_with_str() {
        let path = "files/default/logs/gke-fluentbit/2023/04/14/08/kuberneteshost=gke-dev1/kubernetesnamespacename=ziox-dev/7052558621820981249.parquet";
        let filters = vec![
            (vec![], true),
            (
                vec![("kuberneteshost".to_string(), vec!["gke-dev1".to_string()])],
                true,
            ),
            (
                vec![("kuberneteshost".to_string(), vec!["gke-dev2".to_string()])],
                false,
            ),
            (
                vec![(
                    "kuberneteshost".to_string(),
                    vec!["gke-dev1".to_string(), "gke-dev2".to_string()],
                )],
                true,
            ),
            (
                vec![("some_other_key".to_string(), vec!["no-matter".to_string()])],
                true,
            ),
            (
                vec![
                    ("kuberneteshost".to_string(), vec!["gke-dev1".to_string()]),
                    (
                        "kubernetesnamespacename".to_string(),
                        vec!["ziox-dev".to_string()],
                    ),
                ],
                true,
            ),
            (
                vec![
                    ("kuberneteshost".to_string(), vec!["gke-dev1".to_string()]),
                    (
                        "kubernetesnamespacename".to_string(),
                        vec!["abcdefg".to_string()],
                    ),
                ],
                false,
            ),
            (
                vec![
                    ("kuberneteshost".to_string(), vec!["gke-dev2".to_string()]),
                    (
                        "kubernetesnamespacename".to_string(),
                        vec!["ziox-dev".to_string()],
                    ),
                ],
                false,
            ),
            (
                vec![
                    ("kuberneteshost".to_string(), vec!["gke-dev2".to_string()]),
                    (
                        "kubernetesnamespacename".to_string(),
                        vec!["abcdefg".to_string()],
                    ),
                ],
                false,
            ),
            (
                vec![
                    (
                        "kuberneteshost".to_string(),
                        vec!["gke-dev1".to_string(), "gke-dev2".to_string()],
                    ),
                    (
                        "kubernetesnamespacename".to_string(),
                        vec!["ziox-dev".to_string()],
                    ),
                ],
                true,
            ),
            (
                vec![
                    (
                        "kuberneteshost".to_string(),
                        vec!["gke-dev1".to_string(), "gke-dev2".to_string()],
                    ),
                    (
                        "kubernetesnamespacename".to_string(),
                        vec!["abcdefg".to_string()],
                    ),
                ],
                false,
            ),
            (
                vec![
                    (
                        "kuberneteshost".to_string(),
                        vec!["gke-dev1".to_string(), "gke-dev2".to_string()],
                    ),
                    ("some_other_key".to_string(), vec!["no-matter".to_string()]),
                ],
                true,
            ),
        ];
        for (filter, expected) in filters {
            assert_eq!(filter_source_by_partition_key(path, &filter), expected);
        }
    }
}
